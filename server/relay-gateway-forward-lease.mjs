// Multiple desktops can share one gateway. The last owner restores the original
// active forwarding state. Pre-enabled interfaces are left entirely alone.
export function forwardingLease(platform, op, action, init, state, add, undo) {
  if (op.transient) return init + '\n' + ({ state, owned:state, add, undo })[action];
  if (!/^[a-f0-9-]{36}$/.test(op.owner)) throw Error('转发部署标记无效。');
  if (platform === 'win32') {
    const key = "HKLM:\\SOFTWARE\\DevKit-Gateway-" + op.ip;
    const identity = `$key='${key}'; $owner='${op.owner}'\n`;
    const setup = identity + `$before=& { ${state} }
$owners=@()
if (Test-Path -LiteralPath $key) { $owners=@((Get-Item -LiteralPath $key).GetValueNames()) }
`;
    const inspect = `if ($owners -contains $owner) { if ($before -eq 'present') { 'present' } else { 'partial' } }
elseif ($owners.Count) { 'missing' } else { $before }`;
    if (action === 'owned') return identity + "if ((Test-Path $key) -and ((Get-Item -LiteralPath $key).GetValueNames() -contains $owner)) { 'present' } else { 'missing' }";
    if (action === 'state') return init + '\n' + setup + inspect;
    const change = action === 'add' ? `
if (!$owners.Count -and $before -eq 'present') { return }
if (!(Test-Path -LiteralPath $key)) { New-Item -Path $key -ErrorAction Stop | Out-Null }
New-ItemProperty -LiteralPath $key -Name $owner -PropertyType DWord -Value 1 -Force | Out-Null
if ($before -ne 'present') { ${add} }` : `
if ($owners -contains $owner) {
  if ($owners.Count -eq 1) {
    if ($before -eq 'present') { ${undo} }
    Remove-Item -LiteralPath $key
  } else { Remove-ItemProperty -LiteralPath $key -Name $owner }
}`;
    return init + `
$mutex=[Threading.Mutex]::new($false,'Global\\DevKit-Gateway-${op.ip}')
try {
  try { $locked=$mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $locked=$true }
  if (!$locked) { throw '网关接口正在被另一部署修改，请稍后重试' }
  try { ${setup}${change} } finally { $mutex.ReleaseMutex() }
} finally { $mutex.Dispose() }`;
  }
  const setup = `lease=/run/devkit-fwd-${op.ip}
owner="$lease/${op.owner}"
before=$( ${state} )
`;
  if (action === 'owned') return `if [ -f /run/devkit-fwd-${op.ip}/${op.owner} ]; then echo present; else echo missing; fi`;
  if (action === 'state') return init + '\n' + setup + `
if [ -f "$owner" ]; then
  if [ "$before" = present ]; then echo present; else echo partial; fi
elif [ -d "$lease" ]; then echo missing
else echo "$before"; fi`;
  const change = action === 'add' ? `
if [ ! -d "$lease" ] && [ "$before" = present ]; then exit 0; fi
mkdir -p -m 755 "$lease"
touch "$owner"
if [ "$before" != present ]; then ${add}; fi` : `
if [ -f "$owner" ]; then
  set -- "$lease"/*
  if [ "$#" = 1 ] && [ "$before" = present ]; then ${undo}; fi
  rm -- "$owner"
  if [ "$#" = 1 ]; then rmdir "$lease"; fi
fi`;
  return init + '\nexec 9</run\nflock -x -w 15 9\n' + setup + change;
}
