# 颜色采样工具: 打印指定坐标周围小方块内出现频率最高的若干颜色。
# 用法: pwsh -File calibrate_colors.ps1 -Image <截图> -Points "A:536:537,R:1625:423,bg:1000:880" [-Radius 34]
#
# 用途: 新活动地图的图标配色可能和上一期不同, 先用它采样节点图标的真实 RGB,
#       再据此调整 detect_nodes.ps1 里 Get-Class 的阈值。
#       输出颜色已量化到 12 的倍数, 便于聚簇观察。

param(
    [Parameter(Mandatory=$true)][string]$Image,
    [Parameter(Mandatory=$true)][string]$Points,
    [int]$Radius = 34
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile($Image)
$W = $bmp.Width; $H = $bmp.Height
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$bmp.UnlockBits($data); $bmp.Dispose()

Write-Output "image: ${W}x${H}  quantized to multiples of 12"
foreach ($p in $Points.Split(',')) {
    $f = $p.Split(':')
    if ($f.Count -lt 3) { Write-Output "skip bad point: $p"; continue }
    $name = $f[0]; $px = [int]$f[1]; $py = [int]$f[2]
    $hist = @{}
    for ($dy = -$Radius; $dy -le $Radius; $dy++) {
        $y = $py + $dy
        if ($y -lt 0 -or $y -ge $H) { continue }
        for ($dx = -$Radius; $dx -le $Radius; $dx++) {
            $x = $px + $dx
            if ($x -lt 0 -or $x -ge $W) { continue }
            $o = $y * $stride + $x * 4
            $r = [int](($buf[$o + 2]) / 12) * 12
            $g = [int](($buf[$o + 1]) / 12) * 12
            $b = [int](($buf[$o]) / 12) * 12
            $q = "$r,$g,$b"
            if ($hist.ContainsKey($q)) { $hist[$q]++ } else { $hist[$q] = 1 }
        }
    }
    Write-Output "=== $name ($px,$py) top colors ==="
    $hist.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 6 | ForEach-Object {
        Write-Output ("   {0,-16} {1}" -f $_.Key, $_.Value)
    }
}
