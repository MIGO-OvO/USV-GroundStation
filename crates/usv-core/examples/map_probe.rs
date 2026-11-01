//! Read-only Windows positioning and Google tile/cache smoke check.
use std::path::PathBuf;
use usv_core::maps::MapCache;

fn main() -> Result<(), String> {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("Usage: cargo run -p usv-core --example map_probe -- <cache-directory>")?;
    let cache = MapCache::new(&root)?;
    match cache.local_position(false) {
        Ok(p) => println!("Windows position received, accuracy={} m", p.accuracy_m),
        Err(e) => println!("Windows position unavailable: {e}"),
    }
    let online = cache.google_tile("gsatellite", 0, 0, 0, false)?;
    let restarted = MapCache::new(&root)?;
    let offline = restarted.google_tile("gsatellite", 0, 0, 0, true)?;
    assert_eq!(online, offline);
    println!(
        "Google satellite: {} bytes; offline restart: identical; {}",
        online.len(),
        restarted.stats()?
    );
    Ok(())
}
