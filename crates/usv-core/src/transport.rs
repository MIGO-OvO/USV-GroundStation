use crate::Result;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
    time::Duration,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionConfig {
    Udp { bind: String, peer: Option<String> },
    Tcp { host: String, port: u16 },
    Serial { port: String, baud: u32 },
}
impl Default for ConnectionConfig {
    fn default() -> Self {
        Self::Udp {
            bind: "0.0.0.0:14550".into(),
            peer: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SavedConnection {
    pub config: ConnectionConfig,
    pub target_system: Option<u8>,
}
impl SavedConnection {
    pub fn validate(&self) -> Result<()> {
        if self.target_system == Some(0) {
            return Err("目标 sysid 必须在 1 至 255 之间".into());
        }
        match &self.config {
            ConnectionConfig::Udp { bind, .. } => {
                if bind.trim().is_empty() {
                    return Err("UDP 监听地址无效".into());
                }
            }
            ConnectionConfig::Tcp { host, port } => {
                if host.trim().is_empty() || *port == 0 {
                    return Err("TCP 地址或端口无效".into());
                }
            }
            ConnectionConfig::Serial { port, baud } => {
                if port.trim().is_empty() || *baud == 0 {
                    return Err("串口或波特率无效".into());
                }
            }
        }
        Ok(())
    }
}
pub enum Transport {
    Tcp(TcpStream),
    Udp {
        socket: UdpSocket,
        peer: Option<SocketAddr>,
    },
    #[cfg(windows)]
    Serial(Box<dyn serialport::SerialPort>),
}
impl Transport {
    pub fn open(config: &ConnectionConfig) -> Result<Self> {
        match config {
            ConnectionConfig::Tcp { host, port } => {
                if host.trim().is_empty() || *port == 0 {
                    return Err("TCP 地址或端口无效".into());
                }
                let address = (host.as_str(), *port)
                    .to_socket_addrs()
                    .map_err(|e| e.to_string())?
                    .next()
                    .ok_or("TCP 地址无法解析")?;
                let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
                    .map_err(|e| e.to_string())?;
                stream.set_nonblocking(true).map_err(|e| e.to_string())?;
                stream.set_nodelay(true).map_err(|e| e.to_string())?;
                Ok(Self::Tcp(stream))
            }
            ConnectionConfig::Udp { bind, peer } => {
                let socket = UdpSocket::bind(bind).map_err(|e| e.to_string())?;
                socket.set_nonblocking(true).map_err(|e| e.to_string())?;
                let peer = peer
                    .as_ref()
                    .filter(|p| !p.is_empty())
                    .map(|p| {
                        p.to_socket_addrs()
                            .map_err(|e| e.to_string())?
                            .next()
                            .ok_or_else(|| String::from("UDP 对端无法解析"))
                    })
                    .transpose()?;
                Ok(Self::Udp { socket, peer })
            }
            ConnectionConfig::Serial { port, baud } => {
                #[cfg(windows)]
                {
                    serialport::new(port, *baud)
                        .timeout(Duration::from_millis(5))
                        .open()
                        .map(Self::Serial)
                        .map_err(|e| e.to_string())
                }
                #[cfg(not(windows))]
                {
                    let _ = (port, baud);
                    Err("此平台未开放串口连接".into())
                }
            }
        }
    }
    pub fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<(usize, Option<SocketAddr>)> {
        match self {
            Self::Tcp(s) => {
                let n = s.read(bytes)?;
                if n == 0 {
                    return Err(std::io::ErrorKind::UnexpectedEof.into());
                }
                Ok((n, None))
            }
            Self::Udp { socket, peer } => {
                let (n, from) = socket.recv_from(bytes)?;
                if peer.is_some_and(|p| p != from) {
                    return Err(std::io::ErrorKind::WouldBlock.into());
                }
                Ok((n, Some(from)))
            }
            #[cfg(windows)]
            Self::Serial(s) => s.read(bytes).map(|n| (n, None)),
        }
    }
    pub fn set_discovered_peer(&mut self, from: SocketAddr) {
        if let Self::Udp { peer, .. } = self
            && peer.is_none()
        {
            *peer = Some(from);
        }
    }
    pub fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Tcp(s) => s.write(bytes),
            Self::Udp { socket, peer } => {
                socket.send_to(bytes, peer.ok_or(std::io::ErrorKind::NotConnected)?)
            }
            #[cfg(windows)]
            Self::Serial(s) => s.write(bytes),
        }
    }
    pub fn datagram(&self) -> bool {
        matches!(self, Self::Udp { .. })
    }
}
