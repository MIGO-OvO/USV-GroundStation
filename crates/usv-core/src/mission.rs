#![allow(deprecated)] // Legacy float mission peers remain interoperable.
use crate::{Result,wire::{WireMessage,standard::*}};
use mavlink::Message;
use serde::{Serialize,Deserialize};

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
pub struct Waypoint {pub lat:f64,pub lon:f64,#[serde(default)] pub altitude:f32,#[serde(default)] pub sample:bool,#[serde(default="sample_timeout")] pub timeout_s:u8}
fn sample_timeout()->u8{255}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
pub struct MissionDraft {pub version:u8,pub waypoints:Vec<Waypoint>}
impl Default for MissionDraft {fn default()->Self{Self{version:1,waypoints:vec![]}}}

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
pub struct MissionItem {
    pub seq:u16,pub command:u16,pub frame:u8,pub params:[f32;4],pub x:i32,pub y:i32,pub z:f32,pub autocontinue:u8,
}
impl MissionDraft {
    pub fn build(&self)->Result<Vec<MissionItem>> {
        if self.version!=1||self.waypoints.is_empty()||self.waypoints.len()>500 {return Err("任务需包含 1 至 500 个航点，格式版本为 1".into());}
        let mut items=vec![];
        for w in &self.waypoints {
            if !w.lat.is_finite()||!w.lon.is_finite()||!w.altitude.is_finite()||!(-90.0..=90.0).contains(&w.lat)||!(-180.0..=180.0).contains(&w.lon)||w.timeout_s==0 {
                return Err("航点坐标、高度或采样超时无效".into());
            }
            let item=MissionItem{seq:items.len() as u16,command:16,frame:6,params:[0.0;4],x:(w.lat*1e7).round() as i32,y:(w.lon*1e7).round() as i32,z:w.altitude,autocontinue:1};
            if items.is_empty(){items.push(item.clone());} // ArduPilot sequence 0 is the home placeholder.
            let mut item=item;item.seq=items.len() as u16;items.push(item);
            if w.sample {items.push(MissionItem{seq:items.len() as u16,command:42702,frame:6,params:[1.0,w.timeout_s as f32,0.0,0.0],x:0,y:0,z:0.0,autocontinue:1});}
        }
        Ok(items)
    }
    pub fn from_items(items:&[MissionItem])->Result<Self> {
        let mut draft=Self::default();
        for item in items.iter().skip(1) {
            match item.command {
                16 if [3,6].contains(&item.frame)=>draft.waypoints.push(Waypoint{lat:item.x as f64/1e7,lon:item.y as f64/1e7,altitude:item.z,sample:false,timeout_s:255}),
                42702 if item.params[0]==1.0 && item.params[1]>=1.0 && item.params[1]<=255.0=>{
                    let w=draft.waypoints.last_mut().ok_or("采样项之前缺少航点")?;
                    if w.sample{return Err("同一航点有重复采样项，保留原始任务查看".into());}
                    w.sample=true;w.timeout_s=item.params[1] as u8;
                }
                _=>return Err(format!("任务含未支持的命令 {} 或坐标系 {}，保留原始任务查看",item.command,item.frame))
            }
        }
        if !draft.waypoints.is_empty(){draft.build()?;}
        Ok(draft)
    }
}
impl MissionItem {
    pub fn message(&self,system:u8,component:u8,int:bool)->Result<WireMessage> {
        let command=num_traits::FromPrimitive::from_u16(self.command).ok_or("任务命令不在 ArduPilot dialect 内")?;
        let frame=if int {MavFrame::MAV_FRAME_GLOBAL_RELATIVE_ALT_INT}else{MavFrame::MAV_FRAME_GLOBAL_RELATIVE_ALT};
        if int {Ok(MavMessage::MISSION_ITEM_INT(MISSION_ITEM_INT_DATA{target_system:system,target_component:component,seq:self.seq,command,frame,
            current:0,autocontinue:self.autocontinue,param1:self.params[0],param2:self.params[1],param3:self.params[2],param4:self.params[3],x:self.x,y:self.y,z:self.z,
            ..Default::default()}).into())}
        else {Ok(MavMessage::MISSION_ITEM(MISSION_ITEM_DATA{target_system:system,target_component:component,seq:self.seq,command,frame,
            current:0,autocontinue:self.autocontinue,param1:self.params[0],param2:self.params[1],param3:self.params[2],param4:self.params[3],x:self.x as f32/1e7,y:self.y as f32/1e7,z:self.z,
            ..Default::default()}).into())}
    }
}

#[derive(Debug,Clone,Default,Serialize,Deserialize)]
pub struct MissionSnapshot {
    pub state:String,pub detail:String,pub completed:usize,pub total:usize,pub verified:bool,
    pub items:Vec<MissionItem>,pub draft:Option<MissionDraft>,
}
pub struct MissionManager {
    pub snapshot:MissionSnapshot,
    expected:Option<Vec<MissionItem>>,requested:Vec<bool>,received:Vec<MissionItem>,
    target:(u8,u8),sender:(u8,u8),last:Option<WireMessage>,at:u64,started:u64,retries:u8,
}
impl Default for MissionManager {fn default()->Self{Self{snapshot:MissionSnapshot{state:"idle".into(),..Default::default()},expected:None,requested:vec![],received:vec![],target:(0,1),sender:(254,190),last:None,at:0,started:0,retries:0}}}
impl MissionManager {
    pub fn busy(&self)->bool{matches!(self.snapshot.state.as_str(),"uploading"|"awaiting_count"|"reading")}
    fn send(&mut self,m:WireMessage,now:u64)->Vec<WireMessage>{self.last=Some(m.clone());self.at=now;self.retries=0;vec![m]}
    pub fn start_upload(&mut self,draft:MissionDraft,target:(u8,u8),sender:(u8,u8),now:u64)->Result<Vec<WireMessage>> {
        if self.busy(){return Err("已有任务传输正在进行".into());}
        let items=draft.build()?;self.target=target;self.sender=sender;self.started=now;self.received.clear();self.requested=vec![false;items.len()];
        self.snapshot=MissionSnapshot{state:"uploading".into(),detail:"等待飞控请求任务项".into(),total:items.len(),draft:Some(draft),..Default::default()};
        self.expected=Some(items);
        Ok(self.send(MavMessage::MISSION_COUNT(MISSION_COUNT_DATA{target_system:target.0,target_component:target.1,count:self.snapshot.total as u16,..Default::default()}).into(),now))
    }
    pub fn start_download(&mut self,target:(u8,u8),sender:(u8,u8),now:u64)->Result<Vec<WireMessage>> {
        if self.busy(){return Err("已有任务传输正在进行".into());}
        self.target=target;self.sender=sender;self.started=now;self.expected=None;self.received.clear();
        self.snapshot=MissionSnapshot{state:"awaiting_count".into(),detail:"等待任务数量".into(),..Default::default()};
        let request=self.request_list();Ok(self.send(request,now))
    }
    fn request_list(&self)->WireMessage {MavMessage::MISSION_REQUEST_LIST(MISSION_REQUEST_LIST_DATA{target_system:self.target.0,target_component:self.target.1,..Default::default()}).into()}
    fn request_item(&self,seq:u16)->WireMessage {MavMessage::MISSION_REQUEST_INT(MISSION_REQUEST_INT_DATA{target_system:self.target.0,target_component:self.target.1,seq,..Default::default()}).into()}
    pub fn abort(&mut self,reason:&str){if self.busy(){self.snapshot.state="failed".into();self.snapshot.detail=reason.into();self.snapshot.verified=false;self.last=None;}}
    pub fn on_message(&mut self,m:&WireMessage,now:u64)->Result<Vec<WireMessage>> {
        if !self.busy(){return Ok(vec![]);}
        if m.target_system_id()!=Some(self.sender.0)||!matches!(m.target_component_id(),Some(0)|Some(190)){return Ok(vec![]);}
        let WireMessage::Standard(m)=m else{return Ok(vec![]);};
        match m {
            MavMessage::MISSION_REQUEST_INT(b) if self.snapshot.state=="uploading" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>self.upload_item(b.seq,true,now),
            MavMessage::MISSION_REQUEST(b) if self.snapshot.state=="uploading" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>self.upload_item(b.seq,false,now),
            MavMessage::MISSION_ACK(b) if self.snapshot.state=="uploading" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>{
                if b.mavtype!=MavMissionResult::MAV_MISSION_ACCEPTED {self.abort(&format!("飞控拒绝上传: {:?}",b.mavtype));return Ok(vec![]);}
                if self.requested.iter().any(|v|!*v){self.abort("飞控 ACK 到达但仍缺少任务项请求");return Ok(vec![]);}
                self.snapshot.state="awaiting_count".into();self.snapshot.detail="上传 ACK 已到，开始逐项回读".into();self.snapshot.completed=0;
                let request=self.request_list();Ok(self.send(request,now))
            }
            MavMessage::MISSION_COUNT(b) if self.snapshot.state=="awaiting_count" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>{
                if b.count>1001 {self.abort("飞控任务超过 1001 项");return Ok(vec![]);}
                if self.expected.as_ref().is_some_and(|e|e.len()!=b.count as usize){self.abort("回读任务数量与上传不一致");return Ok(vec![]);}
                self.snapshot.total=b.count as usize;self.received.clear();
                if b.count==0{return self.finish(now);}
                self.snapshot.state="reading".into();let request=self.request_item(0);Ok(self.send(request,now))
            }
            MavMessage::MISSION_ITEM_INT(b) if self.snapshot.state=="reading" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>{
                let item=MissionItem{seq:b.seq,command:b.command as u16,frame:b.frame as u8,params:[b.param1,b.param2,b.param3,b.param4],x:b.x,y:b.y,z:b.z,autocontinue:b.autocontinue};
                self.read_item(item,now)
            }
            MavMessage::MISSION_ITEM(b) if self.snapshot.state=="reading" && b.mission_type==MavMissionType::MAV_MISSION_TYPE_MISSION=>{
                let item=MissionItem{seq:b.seq,command:b.command as u16,frame:b.frame as u8,params:[b.param1,b.param2,b.param3,b.param4],x:(b.x as f64*1e7).round() as i32,y:(b.y as f64*1e7).round() as i32,z:b.z,autocontinue:b.autocontinue};
                self.read_item(item,now)
            }
            _=>Ok(vec![])
        }
    }
    fn upload_item(&mut self,seq:u16,int:bool,now:u64)->Result<Vec<WireMessage>> {
        let Some(item)=self.expected.as_ref().and_then(|v|v.get(seq as usize))else{self.abort("飞控请求了越界任务项");return Ok(vec![]);};
        let message=item.message(self.target.0,self.target.1,int)?;
        self.requested[seq as usize]=true;self.snapshot.completed=self.requested.iter().filter(|v|**v).count();
        self.snapshot.detail=format!("任务项 {seq} 已排队，等待飞控 ACK");Ok(self.send(message,now))
    }
    fn read_item(&mut self,item:MissionItem,now:u64)->Result<Vec<WireMessage>> {
        if item.seq as usize!=self.received.len(){return Ok(vec![]);}
        if !item.z.is_finite()||item.params.iter().any(|p|!p.is_finite()){self.abort("任务回读包含非有限参数");return Ok(vec![]);}
        self.received.push(item);self.snapshot.completed=self.received.len();
        if self.received.len()==self.snapshot.total {self.finish(now)}
        else {let request=self.request_item(self.received.len() as u16);Ok(self.send(request,now))}
    }
    fn finish(&mut self,_now:u64)->Result<Vec<WireMessage>> {
        let matches=self.expected.as_ref().is_none_or(|items|items.iter().zip(&self.received).all(|(a,b)|same_item(a,b)));
        self.snapshot.items=self.received.clone();self.snapshot.draft=MissionDraft::from_items(&self.received).ok();
        self.snapshot.verified=matches && self.snapshot.draft.is_some();self.last=None;
        self.snapshot.state=if matches {if self.expected.is_some(){"verified"}else{"downloaded"}}else{"failed"}.into();
        self.snapshot.detail=if matches {"任务已完整回读；采样执行结果另由 ROS 确认"}else{"任务回读与上传内容不一致"}.into();
        Ok(vec![MavMessage::MISSION_ACK(MISSION_ACK_DATA{target_system:self.target.0,target_component:self.target.1,mavtype:if matches{MavMissionResult::MAV_MISSION_ACCEPTED}else{MavMissionResult::MAV_MISSION_ERROR},..Default::default()}).into()])
    }
    pub fn tick(&mut self,now:u64)->Vec<WireMessage> {
        if !self.busy(){return vec![];}
        if now.saturating_sub(self.started)>300000 {self.abort("任务传输超过 300 秒");return vec![];}
        if now.saturating_sub(self.at)>=1500 {
            if self.retries>=3 {self.abort("任务协议响应超时");return vec![];}
            self.retries+=1;self.at=now;return self.last.clone().into_iter().collect();
        }
        vec![]
    }
}
pub fn same_item(a:&MissionItem,b:&MissionItem)->bool {
    a.seq==b.seq && a.command==b.command && (a.frame==b.frame||[3,6].contains(&a.frame)&&[3,6].contains(&b.frame))
        && (a.x as i64-b.x as i64).abs()<=1 && (a.y as i64-b.y as i64).abs()<=1 && (a.z-b.z).abs()<=0.01
        && a.params.iter().zip(&b.params).all(|(a,b)|(a-b).abs()<=1e-5) && a.autocontinue==b.autocontinue
}
