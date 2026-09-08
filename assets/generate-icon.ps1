# Rebuild the existing Georgia italic m + orange dot as vector and multi-size Windows resources.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$culture = [Globalization.CultureInfo]::InvariantCulture
$mark = New-Object Drawing.Drawing2D.GraphicsPath
$font = New-Object Drawing.FontFamily('Georgia')
$mark.AddString('m', $font, [int][Drawing.FontStyle]::Italic, 128, [Drawing.PointF]::new(0, 0), [Drawing.StringFormat]::GenericTypographic)
$bounds = $mark.GetBounds()
$scale = 94 / $bounds.Width
$matrix = [Drawing.Drawing2D.Matrix]::new([single]$scale, 0, 0, [single]$scale, [single](14 - $bounds.X * $scale), [single](99.5 - $bounds.Bottom * $scale))
$mark.Transform($matrix)
$points = $mark.PathPoints; $types = $mark.PathTypes
$commands = [Collections.Generic.List[string]]::new()
function PointText($point) { $point.X.ToString('0.####', $culture) + ' ' + $point.Y.ToString('0.####', $culture) }
for ($index = 0; $index -lt $points.Length; $index++) {
    $kind = $types[$index] -band 7
    if ($kind -eq 0) { $commands.Add('M' + (PointText $points[$index])) }
    elseif ($kind -eq 1) { $commands.Add('L' + (PointText $points[$index])) }
    elseif ($kind -eq 3) { $commands.Add('C' + (PointText $points[$index]) + ' ' + (PointText $points[$index+1]) + ' ' + (PointText $points[$index+2])); $index += 2 }
    if ($types[$index] -band 128) { $commands.Add('Z') }
}
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="18" fill="#f6f5f1"/><path fill="#272b29" d="' + ($commands -join ' ') + '"/><circle cx="104" cy="35.5" r="7" fill="#cb5c38"/></svg>'
[IO.File]::WriteAllText((Join-Path $root 'public/micro.svg'), $svg + "`n", [Text.UTF8Encoding]::new($false))
$sizes = @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
$frames = [Collections.Generic.List[byte[]]]::new()
$ink = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#272b29'))
$orange = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#cb5c38'))
$paper = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f6f5f1'))
$tile = New-Object Drawing.Drawing2D.GraphicsPath
foreach ($corner in @(@(0,0,180), @(92,0,270), @(92,92,0), @(0,92,90))) { $tile.AddArc($corner[0], $corner[1], 36, 36, $corner[2], 90) }
$tile.CloseFigure()
foreach ($size in $sizes) {
    $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 128, $size / 128)
    $graphics.FillPath($paper, $tile); $graphics.FillPath($ink, $mark); $graphics.FillEllipse($orange, 97, 28.5, 14, 14)
    $stream = [IO.MemoryStream]::new(); $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png); $frames.Add($stream.ToArray())
    $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$file = [IO.File]::Create((Join-Path $PSScriptRoot 'micro.ico')); $writer = [IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Length)
$offset = 6 + 16 * $sizes.Length
for ($index = 0; $index -lt $sizes.Length; $index++) {
    $writer.Write([byte]($sizes[$index] % 256)); $writer.Write([byte]($sizes[$index] % 256)); $writer.Write([uint16]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$index].Length); $writer.Write([uint32]$offset)
    $offset += $frames[$index].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
$writer.Dispose(); $mark.Dispose(); $font.Dispose(); $matrix.Dispose(); $tile.Dispose(); $ink.Dispose(); $orange.Dispose(); $paper.Dispose()
Write-Output ('Generated micro.svg and micro.ico (' + ($sizes -join ', ') + ' px).')
