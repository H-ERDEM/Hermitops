//! CBOM üretici CLI.
//!
//!   cargo run --quiet --bin cbom                 # CBOM'u stdout'a yazar
//!   cargo run --quiet --bin cbom -- --out docs/cbom.json   # dosyaya yazar
//!
//! Üretilen CycloneDX 1.6 belgesi src/cbom.rs'teki tek doğruluk kaynağından gelir.

use std::io::Write;

fn main() {
    let json = vc_tasks::cbom::cbom_json();
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--out") {
        let path = args.get(i + 1).unwrap_or_else(|| {
            eprintln!("--out için dosya yolu gerekli");
            std::process::exit(2);
        });
        std::fs::write(path, format!("{json}\n")).unwrap_or_else(|e| {
            eprintln!("yazılamadı {path}: {e}");
            std::process::exit(1);
        });
        eprintln!("CBOM yazıldı: {path}");
    } else {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{json}");
    }
}
