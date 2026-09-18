# 从拂晓地图截图中自动检测节点图标的中心坐标。
# 用法: pwsh -File detect_nodes.ps1 -Image <截图路径> [-Overlay <输出叠加图路径>] [-Loose]
#
# 原理: 按图标颜色把像素分成 蓝(战斗点六边形) / 红(boss骷髅) / 绿(油罐/爱心) / 灰(未探明六边形) 四类。
#       先按 16px 桶统计并丢掉稀疏桶(滤掉抗锯齿噪声), 再把相邻桶合并成簇, 用像素数加权求中心,
#       最后按 bbox 尺寸 + 长宽比筛选(滤掉虚线、UI 按钮、长条)。
# 注意: 灰色与地图上的白色虚线同色, 灰色簇靠"接近正方形且约 55px"来区分, 可靠性低于其余三色,
#       建议用 -Overlay 出图肉眼复核。-Loose 会放宽所有筛选并打印全部簇, 用于排查漏检。

param(
    [Parameter(Mandatory=$true)][string]$Image,
    [string]$Overlay = "",
    [int]$X0 = 320, [int]$X1 = 1775,
    [int]$Y0 = 190, [int]$Y1 = 1020,
    [int]$BucketSize = 16,
    [int]$MinBucketN = 4,
    [int]$MinClusterN = 40,
    [int]$MinBBox = 28,
    [int]$MaxBBox = 88,
    [double]$AspectMin = 0.55,
    [double]$AspectMax = 1.85,
    [switch]$Loose
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if ($Loose) { $MinClusterN = 15; $MinBBox = 10; $MaxBBox = 400; $AspectMin = 0.1; $AspectMax = 10 }

$bmp = [System.Drawing.Bitmap]::FromFile($Image)
$W = $bmp.Width; $H = $bmp.Height
Write-Output "image: ${W}x${H}  region: ($X0,$Y0)-($X1,$Y1)  loose=$Loose"

$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
$bmp.UnlockBits($data)

function Get-Class([int]$r, [int]$g, [int]$b) {
    $mx = [Math]::Max($r, [Math]::Max($g, $b))
    $mn = [Math]::Min($r, [Math]::Min($g, $b))
    # 淡青蓝六边形环: 实测约 (132,240,252)
    if ($b -ge 225 -and $g -ge 210 -and $r -le 200)              { return 'blue' }
    # 亮绿油罐/爱心: 实测约 (180,252,144)
    if ($g -ge 200 -and $r -le 215 -and $b -le 195)              { return 'green' }
    # 红色骷髅: 实测约 (216,48,72)
    if ($r -ge 185 -and $g -le 125 -and $b -le 145)              { return 'red' }
    # 灰白六边形环: 实测约 (192,192,192)/(168,168,168), 要求接近中性灰
    if (($mx - $mn) -le 18 -and $mn -ge 155)                     { return 'grey' }
    return ''
}

$buckets = @{}
for ($y = $Y0; $y -lt $Y1; $y += 2) {
    $rowBase = $y * $stride
    for ($x = $X0; $x -lt $X1; $x += 2) {
        $o = $rowBase + $x * 4
        $cls = Get-Class $buf[$o + 2] $buf[$o + 1] $buf[$o]
        if ($cls -eq '') { continue }
        $key = "$cls|$([int](($x - $X0) / $BucketSize))|$([int](($y - $Y0) / $BucketSize))"
        $e = $buckets[$key]
        if ($null -eq $e) { $buckets[$key] = [pscustomobject]@{ cls = $cls; n = 1; sx = $x; sy = $y } }
        else { $e.n++; $e.sx += $x; $e.sy += $y }
    }
}
$denseKeys = @($buckets.Keys | Where-Object { $buckets[$_].n -ge $MinBucketN })
Write-Output "matched buckets: $($buckets.Count)  dense(>= $MinBucketN): $($denseKeys.Count)"

$visited = @{}
$all = @()
foreach ($k in $denseKeys) {
    if ($visited.ContainsKey($k)) { continue }
    $cls = $buckets[$k].cls
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($k); $visited[$k] = $true
    $n = 0; $sx = 0.0; $sy = 0.0
    $minX = [int]::MaxValue; $maxX = [int]::MinValue; $minY = [int]::MaxValue; $maxY = [int]::MinValue
    while ($queue.Count -gt 0) {
        $cur = $queue.Dequeue()
        $p = $cur.Split('|')
        $bx = [int]$p[1]; $by = [int]$p[2]
        $e = $buckets[$cur]
        $n += $e.n; $sx += $e.sx; $sy += $e.sy
        if ($bx -lt $minX) { $minX = $bx }; if ($bx -gt $maxX) { $maxX = $bx }
        if ($by -lt $minY) { $minY = $by }; if ($by -gt $maxY) { $maxY = $by }
        for ($dx = -1; $dx -le 1; $dx++) {
            for ($dy = -1; $dy -le 1; $dy++) {
                if ($dx -eq 0 -and $dy -eq 0) { continue }
                $nk = "$cls|$($bx + $dx)|$($by + $dy)"
                if ($buckets.ContainsKey($nk) -and $buckets[$nk].n -ge $MinBucketN -and -not $visited.ContainsKey($nk)) {
                    $visited[$nk] = $true; $queue.Enqueue($nk)
                }
            }
        }
    }
    $all += [pscustomobject]@{
        cls = $cls; n = $n
        cx  = [int]($sx / $n); cy = [int]($sy / $n)
        w   = ($maxX - $minX + 1) * $BucketSize
        h   = ($maxY - $minY + 1) * $BucketSize
    }
}

if ($Loose) {
    Write-Output "ALL clusters (n >= $MinClusterN):"
    $all | Where-Object { $_.n -ge $MinClusterN } | Sort-Object cls, cy, cx |
        Format-Table -AutoSize | Out-String -Width 200 | Write-Output
}

$clusters = @($all | Where-Object {
    $_.n -ge $MinClusterN -and
    $_.w -ge $MinBBox -and $_.h -ge $MinBBox -and
    $_.w -le $MaxBBox -and $_.h -le $MaxBBox -and
    ($_.w / [double]$_.h) -ge $AspectMin -and ($_.w / [double]$_.h) -le $AspectMax
} | Sort-Object cls, cy, cx)

Write-Output "accepted clusters: $($clusters.Count)"
$clusters | Format-Table -AutoSize | Out-String -Width 200 | Write-Output

if ($Overlay -ne "") {
    $canvas = New-Object System.Drawing.Bitmap $W, $H
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.DrawImage($bmp, 0, 0, $W, $H)
    $colors = @{ blue = '#00FFFF'; green = '#00FF00'; red = '#FF0000'; grey = '#FFFF00' }
    $font = New-Object System.Drawing.Font 'Consolas', 14, ([System.Drawing.FontStyle]::Bold)
    $i = 0
    foreach ($c in $clusters) {
        $i++
        $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($colors[$c.cls])), 2
        $g.DrawEllipse($pen, ($c.cx - 28), ($c.cy - 28), 56, 56)
        $g.DrawLine($pen, ($c.cx - 36), $c.cy, ($c.cx + 36), $c.cy)
        $g.DrawLine($pen, $c.cx, ($c.cy - 36), $c.cx, ($c.cy + 36))
        $g.DrawString("#$i $($c.cls.Substring(0,1).ToUpper()) $($c.cx),$($c.cy)", $font,
                      [System.Drawing.Brushes]::White, ($c.cx - 55), ($c.cy + 30))
        $g.DrawString("#$i", $font, [System.Drawing.Brushes]::Black, ($c.cx - 12), ($c.cy - 10))
        $pen.Dispose()
    }
    $g.Dispose()
    $canvas.Save($Overlay, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Output "overlay saved: $Overlay"
}
$bmp.Dispose()
