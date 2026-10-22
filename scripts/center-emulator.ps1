param(
  [Parameter(Mandatory = $true)][string]$AvdName,
  [Parameter(Mandatory = $true)][int]$Port
)

$ErrorActionPreference = 'Stop'
$native = @'
using System;
using System.Runtime.InteropServices;
public static class EmulatorWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}
'@
Add-Type -TypeDefinition $native
$windowTitle = "Android Emulator - ${AvdName}:${Port}"
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while ([DateTime]::UtcNow -lt $deadline) {
  $process = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $windowTitle } | Select-Object -First 1
  $window = if ($process) { $process.MainWindowHandle } else { [IntPtr]::Zero }
  if ($window -ne [IntPtr]::Zero) {
    [void][EmulatorWindow]::ShowWindow($window, 9)
    $rect = New-Object EmulatorWindow+RECT
    if ([EmulatorWindow]::GetWindowRect($window, [ref]$rect)) {
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      $x = [Math]::Max(0, [Math]::Floor(([EmulatorWindow]::GetSystemMetrics(0) - $width) / 2))
      $y = [Math]::Max(0, [Math]::Floor(([EmulatorWindow]::GetSystemMetrics(1) - $height) / 2))
      [void][EmulatorWindow]::SetWindowPos($window, [IntPtr]::Zero, $x, $y, $width, $height, 0x0040 -bor 0x0004)
      Write-Output "Centered '$windowTitle' at ($x,$y) with size ${width}x${height}."
      exit 0
    }
  }
  Start-Sleep -Milliseconds 250
}
throw "The visible emulator window '$windowTitle' was not found to center it."
