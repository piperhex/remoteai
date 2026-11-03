use jni::{
    objects::{JClass, JString},
    sys::jstring,
    JNIEnv,
};
use zeroize::Zeroizing;

#[no_mangle]
pub extern "system" fn Java_com_codexswitch_ssh_NativeSsh_call(
    mut env: JNIEnv,
    _class: JClass,
    input: JString,
) -> jstring {
    let Ok(input) = env.get_string(&input) else {
        return std::ptr::null_mut();
    };
    let input = Zeroizing::new(String::from(input));
    env.new_string(crate::bridge_call(&input))
        .map_or(std::ptr::null_mut(), JString::into_raw)
}
