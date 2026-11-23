$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime
if ($os) {
    $total = [uint64]$os.TotalVisibleMemorySize * 1024
    $used = $total - [uint64]$os.FreePhysicalMemory * 1024
    "ram $used $total"
    "up $([long]((Get-Date) - $os.LastBootUpTime).TotalSeconds)"
}
$processor = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -Property PercentProcessorTime
if ($null -ne $processor.PercentProcessorTime) { "busy $($processor.PercentProcessorTime)" }
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'" -Property Size,FreeSpace
if ($disk.Size) { "vol $env:SystemDrive"; "disk $($disk.Size - $disk.FreeSpace) $($disk.Size)" }
$interfaces = Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface -Property BytesReceivedPersec,BytesSentPersec
if ($interfaces) {
    [uint64]$rx = 0
    [uint64]$tx = 0
    foreach ($interface in $interfaces) {
        $rx += $interface.BytesReceivedPersec
        $tx += $interface.BytesSentPersec
    }
    "net $rx $tx"
}
exit 0
