# 从截图里裁剪指定区域并叠加"设备像素坐标"网格, 用于肉眼读取节点中心坐标。
# 用法: pwsh -File crop_grid.ps1 -Image <截图> -X 580 -Y 420 -W 480 -H 500 -Scale 2 -Out <输出png> [-Step 50]

param(
    [Parameter(Mandatory=$true)][string]$Image,
    [Parameter(Mandatory=$true)][int]$X,
    [Parameter(Mandatory=$true)][int]$Y,
    [Parameter(Mandatory=$true)][int]$W,
    [Parameter(Mandatory=$true)][int]$H,
    [Parameter(Mandatory=$true)][string]$Out,
    [int]$Scale = 2,
    [int]$Step = 50
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($Image)
$crop = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $W, $H),
                   (New-Object System.Drawing.Rectangle $X, $Y, $W, $H), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

$big = New-Object System.Drawing.Bitmap ($W * $Scale), ($H * $Scale)
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = 'NearestNeighbor'
$g2.PixelOffsetMode = 'Half'
$g2.DrawImage($crop, 0, 0, ($W * $Scale), ($H * $Scale))

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 255, 40, 40)), 1
$font = New-Object System.Drawing.Font 'Consolas', 12, ([System.Drawing.FontStyle]::Bold)
# 网格线按设备坐标的 Step 整数倍绘制
$firstX = [Math]::Ceiling($X / $Step) * $Step
for ($dx = $firstX; $dx -lt ($X + $W); $dx += $Step) {
    $px = ($dx - $X) * $Scale
    $g2.DrawLine($pen, $px, 0, $px, ($H * $Scale))
    $g2.DrawString("$dx", $font, [System.Drawing.Brushes]::Yellow, ($px + 3), 3)
}
$firstY = [Math]::Ceiling($Y / $Step) * $Step
for ($dy = $firstY; $dy -lt ($Y + $H); $dy += $Step) {
    $py = ($dy - $Y) * $Scale
    $g2.DrawLine($pen, 0, $py, ($W * $Scale), $py)
    $g2.DrawString("$dy", $font, [System.Drawing.Brushes]::Yellow, 3, ($py + 3))
}
$g2.Dispose()
$big.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose(); $crop.Dispose(); $big.Dispose()
Write-Output "crop origin=($X,$Y) size=${W}x${H} scale=$Scale -> $Out"
