fn main() {
    let result = mavlink_bindgen::generate(
        mavlink_bindgen::XmlDefinitions::Files(vec!["dialect/usv.xml"]),
        std::env::var("OUT_DIR").expect("Cargo OUT_DIR"),
    ).expect("generate wire-compatible command bindings");
    mavlink_bindgen::emit_cargo_build_messages(&result);
}
