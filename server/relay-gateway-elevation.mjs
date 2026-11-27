// The elevated process reads one fixed script, returns its result, and exits.
// Both files stay open without delete sharing across the UAC prompt.
export const windowsElevation = `
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) { & ([ScriptBlock]::Create($body)); exit }
$dir=[IO.Path]::GetTempPath()
$job=[guid]::NewGuid().ToString('N')
$source=[IO.Path]::Combine($dir,"devkit-$job.in")
$result=[IO.Path]::Combine($dir,"devkit-$job.out")
$inputFile=$null; $outputFile=$null
try {
  $inputFile=[IO.File]::Open($source,'CreateNew','ReadWrite','Read')
  $outputFile=[IO.File]::Open($result,'CreateNew','ReadWrite','ReadWrite')
  $bytes=[Text.Encoding]::UTF8.GetBytes($body)
  $inputFile.Write($bytes,0,$bytes.Length); $inputFile.Flush()
  $paths=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@($source,$result) | ConvertTo-Json -Compress)))
  $child=@'
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$paths=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('PATHS')))
try {
  $f=[IO.File]::Open($paths[0],'Open','Read','ReadWrite')
  try { $r=[IO.StreamReader]::new($f,[Text.Encoding]::UTF8); $code=$r.ReadToEnd() } finally { $f.Dispose() }
  $value=(& ([ScriptBlock]::Create($code)) | Out-String).Trim()
  $reply=@{data=$value}
} catch { $reply=@{error=$_.Exception.Message} }
$out=[IO.File]::Open($paths[1],'Open','Write','ReadWrite')
try { $b=[Text.Encoding]::UTF8.GetBytes(($reply | ConvertTo-Json -Compress)); $out.Write($b,0,$b.Length) } finally { $out.Dispose() }
'@
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child.Replace('PATHS',$paths)))
  $p=Start-Process (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -ArgumentList ('-NoProfile -NonInteractive -EncodedCommand '+$encoded) -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw '系统未能执行已授权的网络配置' }
  $reader=[IO.StreamReader]::new($outputFile,[Text.Encoding]::UTF8)
  $reply=ConvertFrom-Json ($reader.ReadToEnd())
  if ($reply.error) { throw $reply.error }
  $reply.data
} finally {
  if ($inputFile) { $inputFile.Dispose(); [IO.File]::Delete($source) }
  if ($outputFile) { $outputFile.Dispose(); [IO.File]::Delete($result) }
}
`;
