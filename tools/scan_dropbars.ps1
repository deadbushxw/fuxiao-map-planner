# 扫描指定横线上的颜色分段, 用于判定掉落列表每个头像顶端的"品质横条"颜色。
# 金色横条 -> 金色掉落; 粉/紫 -> 紫色掉落; 青 -> 普通。
# 用法: pwsh -File scan_dropbars.ps1 -Image <面板截图> -Y 538 -X0 540 -X1 1520

param(
    [Parameter(Mandatory=$true)][string]$Image,
    [Parameter(Mandatory=$true)][int]$Y,
    [int]$X0 = 540, [int]$X1 = 1520,
    [int]$MinRun = 6
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile($Image)
$W = $bmp.Width; $H = $bmp.Height
if ($X1 -gt $W) { $X1 = $W }
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$bmp.UnlockBits($data); $bmp.Dispose()

function Name-Color([int]$r, [int]$g, [int]$b) {
    $mx = [Math]::Max($r, [Math]::Max($g, $b)); $mn = [Math]::Min($r, [Math]::Min($g, $b))
    if (($mx - $mn) -le 26) { if ($mn -ge 150) { return 'white' } else { return 'dark' } }
    if ($r -ge 150 -and $g -ge 120 -and $b -le 130) { return 'GOLD' }   # 金条
    if ($r -ge 150 -and $b -ge 120 -and $g -le 150) { return 'pink' }   # 粉/紫条
    if ($b -ge 130 -and $g -ge 130 -and $r -le 150) { return 'cyan' }   # 青条
    return 'other'
}

$runs = @()
$cur = $null; $len = 0
for ($x = $X0; $x -lt $X1; $x++) {
    $o = $Y * $stride + $x * 4
    $nm = Name-Color $buf[$o + 2] $buf[$o + 1] $buf[$o]
    if ($null -eq $cur -or $nm -ne $cur) {
        if ($null -ne $cur -and $len -ge $MinRun) {
            $runs += [pscustomobject]@{ color = $cur; x0 = ($x - $len); x1 = $x - 1; center = [int](($x - $len) + $len / 2); len = $len }
        }
        $cur = $nm; $len = 1
    } else { $len++ }
}
if ($null -ne $cur -and $len -ge $MinRun) {
    $runs += [pscustomobject]@{ color = $cur; x0 = ($x - $len); x1 = $x - 1; center = [int](($x - $len) + $len / 2); len = $len }
}
Write-Output "scan y=$Y on $([System.IO.Path]::GetFileName($Image))"
$runs | Where-Object { $_.color -ne 'other' } | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
