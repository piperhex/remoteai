use jni::{
    objects::{JClass, JString},
    sys::{jbyteArray, jstring},
    JNIEnv,
};

#[no_mangle]
pub extern "system" fn Java_com_codexswitch_connectivity_NativeConnectivity_call(
    mut env: JNIEnv,
    _class: JClass,
    request: JString,
) -> jstring {
    let reply = match env.get_string(&request) {
        Ok(value) => crate::ffi::call(value.to_string_lossy().as_ref()),
        Err(_) => "{\"error\":\"Invalid request\"}".into(),
    };
    env.new_string(reply)
        .map(JString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// Only a module's own authenticated session can provide bounded, raw file records.
#[no_mangle]
pub extern "system" fn Java_com_codexswitch_connectivity_NativeConnectivity_receiveBulk(
    mut env: JNIEnv,
    _class: JClass,
    owner: JString,
    id: JString,
) -> jbyteArray {
    let result = (|| {
        let owner = env.get_string(&owner).ok()?.to_string_lossy().into_owned();
        let id = env.get_string(&id).ok()?.to_string_lossy().into_owned();
        let record = crate::ffi::receive_bulk(&owner, &id).ok()??;
        env.byte_array_from_slice(&record).ok()
    })();
    result
        .map(|array| array.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
