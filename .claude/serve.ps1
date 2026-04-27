# Minimal static file server for local preview.
# Listens on 127.0.0.1:3000 and serves files from the project root.
$port = 3000
$root = (Resolve-Path "$PSScriptRoot\..").Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "Serving $root on http://127.0.0.1:$port/"

$mime = @{
  '.html'='text/html; charset=utf-8'
  '.css'='text/css; charset=utf-8'
  '.js'='application/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'
  '.png'='image/png'
  '.svg'='image/svg+xml'
  '.jpg'='image/jpeg'
  '.jpeg'='image/jpeg'
  '.ico'='image/x-icon'
  '.woff'='font/woff'
  '.woff2'='font/woff2'
  '.ttf'='font/ttf'
  '.md'='text/markdown; charset=utf-8'
  '.txt'='text/plain; charset=utf-8'
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $urlPath = [uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($urlPath -eq '/') { $urlPath = '/index.html' }
    $file = Join-Path $root $urlPath.TrimStart('/').Replace('/', '\')

    if (Test-Path $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $res.ContentType = $ct
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $urlPath"
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found: $urlPath")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $msg.Length
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "404 $urlPath"
    }
    $res.Close()
  } catch {
    Write-Host "Error: $_"
  }
}
