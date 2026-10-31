use crate::Result;
use serde::{Serialize,Deserialize};
use std::{collections::VecDeque, fs::{self,File,OpenOptions}, io::Write,path::{Path,PathBuf}};

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct Diagnostic {
    pub index:u64,pub unix_ms:u64,pub mono_ms:u64,pub clock_id:String,
    pub kind:String,pub direction:String,pub system:Option<u8>,pub component:Option<u8>,
    pub message_id:Option<u32>,pub mav_sequence:Option<u8>,pub command:Option<u16>,
    pub request:Option<u32>,pub session:Option<u32>,pub detail:serde_json::Value,
}
pub struct Journal {
    dir:PathBuf,file:Option<File>,size:u64,pub records:VecDeque<Diagnostic>,pub error:Option<String>,index:u64,
}
impl Journal {
    pub fn open(dir:&Path)->Self {
        let mut j=Self{dir:dir.into(),file:None,size:0,records:VecDeque::new(),error:None,index:0};
        if let Err(e)=fs::create_dir_all(dir){j.error=Some(e.to_string());return j;}
        match OpenOptions::new().create(true).append(true).open(dir.join("communication.jsonl")) {
            Ok(f)=>{j.size=f.metadata().map_or(0,|m|m.len());j.file=Some(f);},Err(e)=>j.error=Some(e.to_string())
        }
        j
    }
    pub fn append(&mut self,mut d:Diagnostic) {
        self.index+=1;d.index=self.index;
        if self.size>10*1024*1024 {if let Err(e)=self.rotate(){self.error=Some(e);self.file=None;}}
        if let Some(f)=self.file.as_mut() {
            match serde_json::to_vec(&d).map_err(|e|e.to_string()).and_then(|mut b|{b.push(b'\n');f.write_all(&b).map_err(|e|e.to_string())?;Ok(b.len())}) {
                Ok(n)=>self.size+=n as u64,Err(e)=>{self.error=Some(e);self.file=None;}
            }
        }
        self.records.push_back(d);if self.records.len()>2000 {self.records.pop_front();}
    }
    fn rotate(&mut self)->Result<()> {
        if let Some(mut f)=self.file.take(){f.flush().map_err(|e|e.to_string())?;}
        let oldest=self.dir.join("communication.3.jsonl");
        if oldest.exists(){fs::remove_file(oldest).map_err(|e|e.to_string())?;}
        for i in (0..3).rev() {
            let from=self.dir.join(if i==0{"communication.jsonl".into()}else{format!("communication.{i}.jsonl")});
            if from.exists(){fs::rename(from,self.dir.join(format!("communication.{}.jsonl",i+1))).map_err(|e|e.to_string())?;}
        }
        self.file=Some(OpenOptions::new().create(true).append(true).open(self.dir.join("communication.jsonl")).map_err(|e|e.to_string())?);
        self.size=0;Ok(())
    }
    pub fn export(&mut self,snapshot:&impl Serialize,ros:Option<&serde_json::Value>)->Result<Vec<u8>> {
        if let Some(f)=self.file.as_mut(){f.flush().map_err(|e|e.to_string())?;}
        let mut zip=zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options=zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("station-snapshot.json",options).map_err(|e|e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(snapshot).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        for name in ["communication.jsonl","communication.1.jsonl","communication.2.jsonl","communication.3.jsonl"] {
            let path=self.dir.join(name);
            if path.exists(){zip.start_file(name,options).map_err(|e|e.to_string())?;std::io::copy(&mut File::open(path).map_err(|e|e.to_string())?,&mut zip).map_err(|e|e.to_string())?;}
        }
        if let Some(ros)=ros {zip.start_file("jetson-report.json",options).map_err(|e|e.to_string())?;zip.write_all(&serde_json::to_vec_pretty(ros).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;}
        zip.start_file("clocks.txt",options).map_err(|e|e.to_string())?;
        zip.write_all("mono_ms 仅在相同 clock_id 内可相减。unix_ms 为本机接收时间，Jetson/飞控时间属于不同设备；缺失链路阶段保持未确认。\n".as_bytes()).map_err(|e|e.to_string())?;
        Ok(zip.finish().map_err(|e|e.to_string())?.into_inner())
    }
}

pub fn unix_ms()->u64 {std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64}
