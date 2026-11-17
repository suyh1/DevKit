param($Request)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$action = $Request.action

function FileInfo($Path) {
    $file = Get-Item -LiteralPath $Path -Force
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Expected a regular file without links.'
    }
    return $file
}
function HashFile($Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        if ($stream.Length -gt 524288) { throw 'Configuration exceeds 512 KiB.' }
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally { $stream.Dispose(); $algorithm.Dispose() }
}
function HashText($Text) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($utf8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Bounds($Path) {
    $file = FileInfo $Path
    if ($file.Length -gt 524288) { throw 'Configuration exceeds 512 KiB.' }
    return $file
}
function EmitFile($Path) {
    $null = Bounds $Path
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -gt 524288) { throw 'Configuration exceeds 512 KiB.' }
    [Console]::WriteLine('file')
    [Console]::WriteLine([Convert]::ToBase64String($bytes))
}
function WithLock($Key, [scriptblock]$Body) {
    $mutex = New-Object Threading.Mutex($false, "Global\DevKitSsh-$Key")
    $held = $false
    try {
        try { $held = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $held = $true }
        if (!$held) { throw 'The resource is busy. Retry after refreshing.' }
        & $Body
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
function QuoteArgument([string]$Value) {
    $quoted = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    return '"' + ([regex]::Replace($quoted, '(\\+)$', '$1$1')) + '"'
}

if ($action -eq 'check') {
    [Console]::WriteLine('devkit-ssh')
    return
}
$main = $Request.main
$directory = $Request.directory
$stateRoot = Join-Path $HOME '.devkit-ssh'

if ($action -eq 'config-list') {
    if ($Request.module -eq 'jar') {
        Get-ChildItem -LiteralPath $directory -File | Where-Object {
            !($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
        } | ForEach-Object { [Console]::Write($_.Name + [char]0) }
    }
    return
}
if ($action -in @('config-read', 'config-backup', 'config-save')) {
    $file = (Bounds $Request.file).FullName
    $backupRoot = Join-Path $stateRoot 'config-backups'
    $key = HashText $file.ToLowerInvariant()
    $backup = Join-Path $backupRoot "$key.bak"
    if ($action -eq 'config-read') { EmitFile $file; return }
    if ($action -eq 'config-backup') {
        if ([IO.File]::Exists($backup)) { EmitFile $backup }
        else { [Console]::WriteLine('missing') }
        return
    }
    WithLock "config-$key" {
        if ((HashFile $file) -ne $Request.expected) { throw 'Configuration changed. Read the disk version before saving.' }
        $bytes = [Convert]::FromBase64String($Request.content)
        if ($bytes.Length -gt 524288) { throw 'Configuration exceeds 512 KiB.' }
        $null = [IO.Directory]::CreateDirectory($backupRoot)
        $temp = Join-Path ([IO.Path]::GetDirectoryName($file)) ('.devkit-ssh-' + [guid]::NewGuid().ToString('N') + '.tmp')
        $backupTemp = Join-Path $backupRoot ([guid]::NewGuid().ToString('N') + '.tmp')
        try {
            [IO.File]::WriteAllBytes($temp, $bytes)
            if ((HashFile $temp) -ne $Request.expected) {
                [IO.File]::Copy($file, $backupTemp)
                if ((HashFile $backupTemp) -ne $Request.expected) { throw 'Configuration changed. Read it again before saving.' }
                if ([IO.File]::Exists($backup)) { [IO.File]::Replace($backupTemp, $backup, [NullString]::Value) }
                else { [IO.File]::Move($backupTemp, $backup) }
                $null = Bounds $file
                if ((HashFile $file) -ne $Request.expected) { throw 'Configuration changed. Read it again before saving.' }
                [IO.File]::Replace($temp, $file, [NullString]::Value)
            }
        } finally {
            [IO.File]::Delete($temp)
            [IO.File]::Delete($backupTemp)
        }
        [Console]::WriteLine('file')
        [Console]::WriteLine($Request.content)
    }
    return
}

$main = (FileInfo $main).FullName
if ($Request.module -eq 'nginx') {
    if ($action -eq 'validate') {
        foreach ($file in $Request.files) { $null = FileInfo $file }
        return
    }
    $nginx = if ($Request.executable) { $Request.executable } else { 'nginx.exe' }
    $prefix = if ($Request.prefix) { $Request.prefix } else { [IO.Path]::GetDirectoryName((Get-Command $nginx -CommandType Application).Source) }
    $arguments = @('-p', $prefix, '-c', $main)
    & $nginx @arguments -t
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($action -eq 'reload') { & $nginx @arguments -s reload; exit $LASTEXITCODE }
    return
}
if ($action -eq 'validate') { return }

$key = HashText $main.ToLowerInvariant()
$state = Join-Path $stateRoot 'jar'
$null = [IO.Directory]::CreateDirectory($state)
$record = Join-Path $state "$key.pid"
$stdout = Join-Path $state "$key.log"
$stderr = Join-Path $state "$key.err.log"
$marker = "-Ddevkit.ssh.jar=$key"
function ManagedProcess {
    if (![IO.File]::Exists($record)) { return }
    $saved = [IO.File]::ReadAllText((FileInfo $record).FullName) | ConvertFrom-Json
    if ($saved.pid -le 1 -or $saved.created -notmatch '^\d+$') { throw 'Invalid PID record.' }
    $process = Get-Process -Id ([int]$saved.pid) -ErrorAction SilentlyContinue
    if (!$process -or $process.HasExited) { return }
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $saved.created) { return }
    $identity = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $process.Id)
    if (!$identity -or !$identity.CommandLine -or !$identity.CommandLine.Contains($marker) -or !$identity.CommandLine.Contains((QuoteArgument $main))) {
        throw 'Process identity cannot be verified.'
    }
    return $process
}
function StopJar {
    $process = ManagedProcess
    if (!$process) { return }
    Stop-Process -InputObject $process -Force
    if (!$process.WaitForExit(15000)) { throw 'The process did not stop within 15 seconds.' }
    [IO.File]::Delete($record)
}
function StartJar {
    if (ManagedProcess) { throw 'This JAR is already running.' }
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" |
        Where-Object { $_.CommandLine -like "*-jar*" -and $_.CommandLine -like "*$([WildcardPattern]::Escape($main))*" } |
        Select-Object -First 1
    if ($existing) { throw 'A process using this JAR path already exists. Stop it from its original manager first.' }
    $java = if ($Request.executable) { $Request.executable } elseif ($env:JAVA_HOME -and [IO.File]::Exists((Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        Join-Path $env:JAVA_HOME 'bin\java.exe'
    } else { (Get-Command java.exe -CommandType Application).Source }
    $argv = @($marker, '-jar', $main) + @($Request.args)
    $plan = Join-Path $state "$key.launch"
    if ([IO.File]::Exists($plan)) {
        if ([IO.File]::GetLastWriteTimeUtc($plan) -gt [DateTime]::UtcNow.AddMinutes(-2)) { throw 'A launch is still in progress. Refresh its status.' }
        [IO.File]::Delete($plan)
    }
    [IO.File]::Delete($plan + '.error')
    $launchData = @{
        executable = $java; directory = $directory; arguments = ($argv | ForEach-Object { QuoteArgument $_ }) -join ' ';
        stdout = $stdout; stderr = $stderr; record = $record
    }
    [IO.File]::WriteAllText($plan, ($launchData | ConvertTo-Json -Compress), $utf8)
    $planName = [Convert]::ToBase64String($utf8.GetBytes($plan))
    $worker = @'
$ErrorActionPreference = 'Stop'
$plan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PLAN__'))
$details = [IO.File]::ReadAllText($plan) | ConvertFrom-Json
try {
    $process = Start-Process -FilePath $details.executable -WorkingDirectory $details.directory -ArgumentList $details.arguments -RedirectStandardOutput $details.stdout -RedirectStandardError $details.stderr -PassThru -WindowStyle Hidden
    $record = @{ pid = $process.Id; created = $process.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($details.record, $record)
} catch {
    [IO.File]::WriteAllText($plan + '.error', $_.Exception.Message)
} finally {
    [IO.File]::Delete($plan)
}
'@
    $worker = $worker.Replace('__PLAN__', $planName)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
    $powershell = QuoteArgument (Join-Path $PSHOME 'powershell.exe')
    try {
        $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
            CommandLine = "$powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
            CurrentDirectory = $directory
        }
    } catch {
        [IO.File]::Delete($plan)
        throw
    }
    if ($result.ReturnValue -ne 0) {
        [IO.File]::Delete($plan)
        throw "Win32_Process.Create failed with code $($result.ReturnValue)."
    }
    for ($i = 0; $i -lt 40 -and [IO.File]::Exists($plan); $i++) { Start-Sleep -Milliseconds 200 }
    if ([IO.File]::Exists($plan + '.error')) {
        $failure = [IO.File]::ReadAllText($plan + '.error')
        [IO.File]::Delete($plan + '.error')
        throw $failure
    }
    Start-Sleep -Milliseconds 600
    $process = ManagedProcess
    if (!$process) { throw "Java did not stay running. See $stdout and $stderr." }
    [Console]::WriteLine("PID $($process.Id)")
}
function LogTail($Path) {
    if (![IO.File]::Exists($Path)) { return }
    $null = FileInfo $Path
    $reader = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $count = [int][Math]::Min(65536, $reader.Length)
        $null = $reader.Seek(-$count, 'End')
        $bytes = New-Object byte[] $count
        $read = $reader.Read($bytes, 0, $count)
        [Console]::WriteLine($utf8.GetString($bytes, 0, $read))
    } finally { $reader.Dispose() }
}

WithLock "jar-$key" {
    switch ($action) {
        'status' { $process = ManagedProcess; if ($process) { [Console]::WriteLine("PID $($process.Id)") } else { [Console]::WriteLine('stopped') } }
        'start' { StartJar }
        'stop' { StopJar; [Console]::WriteLine('stopped') }
        'restart' { StopJar; StartJar }
        'log' { LogTail $stdout; LogTail $stderr }
    }
}
