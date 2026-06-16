Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\diamo\Desktop\Sistemas prontos\App. Farmacia"
WshShell.Run "node server.js", 0, False
