use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use swc_common::{FileName, SourceMap, sync::Lrc};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax};

#[no_mangle]
pub extern "C" fn swc_parse_typescript(source_ptr: *const c_char) -> *mut c_char {
    let source = unsafe {
        if source_ptr.is_null() {
            return std::ptr::null_mut();
        }
        match CStr::from_ptr(source_ptr).to_str() {
            Ok(s) => s.to_owned(),
            Err(_) => return std::ptr::null_mut(),
        }
    };

    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(Lrc::new(FileName::Anon), source);

    let mut parser = Parser::new(
        Syntax::Typescript(TsSyntax {
            tsx: false,
            decorators: false,
            ..Default::default()
        }),
        StringInput::from(&*fm),
        None,
    );

    match parser.parse_module() {
        Ok(module) => match serde_json::to_string(&module) {
            Ok(json) => match CString::new(json) {
                Ok(c) => c.into_raw(),
                Err(_) => std::ptr::null_mut(),
            },
            Err(_) => std::ptr::null_mut(),
        },
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn swc_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            drop(CString::from_raw(ptr));
        }
    }
}
