Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
startScript = fso.BuildPath(fso.BuildPath(baseDir, "console"), "start-hidden.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Quote(startScript)
shell.Run command, 0, False

WScript.Sleep 2500
shell.Run "http://127.0.0.1:5177", 1, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
