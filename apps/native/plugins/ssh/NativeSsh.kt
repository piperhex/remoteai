package com.codexswitch.ssh

object NativeSsh {
    init { System.loadLibrary("csw_ssh_mobile") }
    @JvmStatic external fun call(request: String): String
}
