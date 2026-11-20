#Requires -Version 5.1

<#
Native file operations for cleanup.

Deletion must be bound to the file object, not to its path:

  * OpenForDelete opens a handle with DELETE access, which pins the object.
  * GetIdentity reads the NTFS file id, size, last-write time and attributes
    from that handle, so the caller can prove the object is still the one that
    was previewed.
  * GetFinalPath resolves where the handle actually points; if a parent
    directory was swapped for a junction after the preview, this returns the
    real target and the caller can refuse it.
  * MarkDelete flags the pinned object for deletion; the file disappears when
    the handle closes. No path is resolved a second time.

Add-Type is only compiled once per session.
#>

if (-not ('CleanupNative' -as [type])) {
    $nativeSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class CleanupNative
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO
    {
        [MarshalAs(UnmanagedType.U1)] public bool DeleteFile;
    }

    private const uint DELETE = 0x00010000;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const int FileDispositionInfo = 4;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFileW(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes,
        uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle hFile, out BY_HANDLE_FILE_INFORMATION info);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle hFile, StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle hFile, int fileInformationClass, ref FILE_DISPOSITION_INFO info, uint dwBufferSize);

    public static SafeFileHandle Open(string path, bool noFollow)
    {
        uint flags = FILE_FLAG_BACKUP_SEMANTICS;
        if (noFollow) flags |= FILE_FLAG_OPEN_REPARSE_POINT;
        SafeFileHandle handle = CreateFileW(
            path, DELETE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING, flags, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error);
        }
        return handle;
    }

    public static string GetFinalPath(SafeFileHandle handle)
    {
        var buffer = new StringBuilder(1024);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (length >= buffer.Capacity)
        {
            buffer = new StringBuilder((int)length + 1);
            length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        string path = buffer.ToString();
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) path = path.Substring(4);
        return path;
    }

    // index 0 = volume serial, 1 = file id, 2 = size, 3 = last write ticks, 4 = attributes
    public static long[] GetIdentity(SafeFileHandle handle)
    {
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        long size = ((long)info.FileSizeHigh << 32) | info.FileSizeLow;
        long fileId = ((long)info.FileIndexHigh << 32) | info.FileIndexLow;
        long writeTicks = ((long)info.LastWriteTime.dwHighDateTime << 32) | (uint)info.LastWriteTime.dwLowDateTime;
        return new long[] { info.VolumeSerialNumber, fileId, size, writeTicks, info.FileAttributes };
    }

    public static void MarkDelete(SafeFileHandle handle)
    {
        var info = new FILE_DISPOSITION_INFO();
        info.DeleteFile = true;
        if (!SetFileInformationByHandle(handle, FileDispositionInfo, ref info, (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
    Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
}

<#
Opens a handle, returns the object identity and the resolved path. Used by both
scan (to record what was previewed) and apply (to prove nothing changed).

The handle is disposed here; callers that need to delete must use Open- and
Close themselves through Invoke-CleanupDelete.
#>
function Get-CleanupFileIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)

    $handle = $null
    try {
        $handle = [CleanupNative]::Open($Path, $false)
        $identity = [CleanupNative]::GetIdentity($handle)
        $resolved = [CleanupNative]::GetFinalPath($handle)
        [pscustomobject]@{
            VolumeSerial = [int64]$identity[0]
            FileId       = [int64]$identity[1]
            Size         = [int64]$identity[2]
            WriteTicks   = [int64]$identity[3]
            Attributes   = [int64]$identity[4]
            ResolvedPath = $resolved
        }
    } catch {
        return $null
    } finally {
        if ($null -ne $handle) { $handle.Dispose() }
    }
}

Export-ModuleMember -Function Get-CleanupFileIdentity
