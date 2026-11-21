# Join the waiting Node launcher to a private job before it starts the service.
param([int]$Launcher)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BackendJob {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long PerProcess, PerJob;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32", SetLastError=true)] static extern IntPtr OpenProcess(uint rights, bool inherit, int pid);
    [DllImport("kernel32", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref ExtendedLimits limits, int size);
    [DllImport("kernel32", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32", SetLastError=true)] static extern bool DuplicateHandle(IntPtr source, IntPtr handle, IntPtr target, out IntPtr copy, uint access, bool inherit, uint options);
    [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static void Attach(int pid) {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        Check(job != IntPtr.Zero);
        IntPtr process = OpenProcess(0x141, false, pid); // SET_QUOTA, DUP_HANDLE, TERMINATE
        try {
            Check(process != IntPtr.Zero);
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits)));
            Check(AssignProcessToJobObject(job, process));
            IntPtr owned;
            Check(DuplicateHandle(new IntPtr(-1), job, process, out owned, 0, false, 2));
        } finally { CloseHandle(process); CloseHandle(job); }
    }
}
'@
[BackendJob]::Attach($Launcher)
