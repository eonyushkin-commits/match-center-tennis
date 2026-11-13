# Editable source of the tennis-ball icon. Run with PowerShell on Windows:
# powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '../src/assets'
[IO.Directory]::CreateDirectory($assetDir) | Out-Null

# Draw at 4x resolution; all sizes are reduced from the same transparent master.
$master = [Drawing.Bitmap]::new(1024, 1024)
$g = [Drawing.Graphics]::FromImage($master)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.ScaleTransform(4, 4)
$ball = [Drawing.Drawing2D.GraphicsPath]::new()
$ball.AddEllipse(12, 12, 232, 232)
$fill = [Drawing.Drawing2D.LinearGradientBrush]::new(
    [Drawing.Point]::new(35, 25), [Drawing.Point]::new(220, 235),
    [Drawing.ColorTranslator]::FromHtml('#e6f85b'),
    [Drawing.ColorTranslator]::FromHtml('#9abd19'))
$g.FillPath($fill, $ball)
$g.SetClip($ball)
$g.TranslateTransform(128, 128)
$g.RotateTransform(-32)
$g.TranslateTransform(-128, -128)
$seams = [Drawing.Drawing2D.GraphicsPath]::new()
$seams.AddBezier(-15, 0, 130, 70, 130, 186, -15, 256)
$seams.StartFigure()
$seams.AddBezier(271, 0, 126, 70, 126, 186, 271, 256)
$groove = [Drawing.Pen]::new([Drawing.Color]::FromArgb(60, 76, 100, 12), 16)
$white = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#fffde4'), 10)
$g.DrawPath($groove, $seams)
$g.DrawPath($white, $seams)
$g.ResetTransform()
$g.ScaleTransform(4, 4)
$g.ResetClip()
$edge = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#303024'), 8)
$g.DrawPath($edge, $ball)
$g.Dispose()
$fill.Dispose()
$groove.Dispose()
$white.Dispose()
$edge.Dispose()
$ball.Dispose()
$seams.Dispose()

$frames = @()
foreach ($size in @(16, 20, 24, 32, 48, 64, 128, 256)) {
    $image = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($image)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($master, [Drawing.Rectangle]::new(0, 0, $size, $size))
    $graphics.Dispose()
    $stream = [IO.MemoryStream]::new()
    $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += @{ Size = $size; Bytes = $stream.ToArray() }
    if ($size -eq 256) { $image.Save((Join-Path $assetDir 'icon.png'), [Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose()
    $image.Dispose()
}
$master.Dispose()

# ICO directory followed by PNG frames (Windows Vista and later).
$output = [IO.File]::Create((Join-Path $assetDir 'icon.ico'))
$writer = [IO.BinaryWriter]::new($output)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
Write-Output 'Created src/assets/icon.png and icon.ico (16-256 px).'
