# 把多个节点面板截图的"标题+条件行"区域横切下来, 纵向拼成一张长图, 便于一次读图录入。
# 用法: pwsh -File compose_rows.ps1 -Dir <shots目录> -Names "A,B,C" -Out <输出png> [-Y0 10 -Y1 500]

param(
    [Parameter(Mandatory=$true)][string]$Dir,
    [Parameter(Mandatory=$true)][string]$Names,
    [Parameter(Mandatory=$true)][string]$Out,
    [int]$X0 = 400, [int]$X1 = 1470,
    [int]$Y0 = 8,  [int]$Y1 = 500
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$list = $Names.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$w = $X1 - $X0
$h = $Y1 - $Y0
$gap = 6
$totalH = $list.Count * ($h + $gap)

$canvas = New-Object System.Drawing.Bitmap $w, $totalH
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::Magenta)
$font = New-Object System.Drawing.Font 'Consolas', 20, ([System.Drawing.FontStyle]::Bold)
$y = 0
foreach ($n in $list) {
    $p = Join-Path $Dir "$n.png"
    if (-not (Test-Path $p)) { Write-Output "MISSING: $p"; $y += $h + $gap; continue }
    $img = [System.Drawing.Image]::FromFile($p)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, $y, $w, $h),
                       (New-Object System.Drawing.Rectangle $X0, $Y0, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
    $img.Dispose()
    # 左上角标注节点名, 便于对号入座
    $g.FillRectangle([System.Drawing.Brushes]::Black, 0, $y, 150, 30)
    $g.DrawString($n, $font, [System.Drawing.Brushes]::Yellow, 4, ($y + 2))
    $y += $h + $gap
}
$g.Dispose()
$canvas.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()
Write-Output "composed $($list.Count) nodes -> $Out  (${w}x${totalH})"
