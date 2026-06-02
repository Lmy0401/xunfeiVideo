Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
stopScript = fso.BuildPath(fso.BuildPath(baseDir, "console"), "stop-hidden.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Quote(stopScript)
shell.Run command, 0, True

MsgBox "控制台服务已停止。", vbInformation, "XunfeiVideo"

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
