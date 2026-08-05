param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "icon.ico")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

$bitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$background = New-RoundedRectanglePath 8 8 240 240 48
$graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 31, 31, 31)), $background)

$controller = [System.Drawing.Drawing2D.GraphicsPath]::new()
$controller.StartFigure()
$controller.AddBezier(52, 174, 40, 142, 48, 98, 79, 82)
$controller.AddBezier(79, 82, 91, 76, 103, 79, 113, 86)
$controller.AddLine(113, 86, 143, 86)
$controller.AddBezier(143, 86, 153, 79, 165, 76, 177, 82)
$controller.AddBezier(177, 82, 208, 98, 216, 142, 204, 174)
$controller.AddBezier(204, 174, 198, 190, 184, 194, 171, 180)
$controller.AddLine(171, 180, 153, 159)
$controller.AddLine(153, 159, 103, 159)
$controller.AddLine(103, 159, 85, 180)
$controller.AddBezier(85, 180, 72, 194, 58, 190, 52, 174)
$controller.CloseFigure()
$graphics.FillPath([System.Drawing.Brushes]::White, $controller)

$darkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 31, 31, 31))
$graphics.FillRectangle($darkBrush, 76, 113, 34, 12)
$graphics.FillRectangle($darkBrush, 87, 102, 12, 34)
$graphics.FillEllipse($darkBrush, 165, 105, 15, 15)
$graphics.FillEllipse($darkBrush, 181, 121, 15, 15)
$graphics.FillEllipse($darkBrush, 146, 119, 9, 9)
$graphics.FillEllipse($darkBrush, 157, 131, 9, 9)

$directory = Split-Path -Parent $OutputPath
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$pngStream = [System.IO.MemoryStream]::new()
try {
    $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $pngStream.ToArray()
    $stream = [System.IO.File]::Create($OutputPath)
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$pngBytes.Length)
        $writer.Write([uint32]22)
        $writer.Write($pngBytes)
    } finally {
        $writer.Dispose()
    }
} finally {
    $pngStream.Dispose()
    $darkBrush.Dispose()
    $controller.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
