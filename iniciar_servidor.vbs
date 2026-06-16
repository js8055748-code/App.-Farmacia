Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\diamo\Desktop\Sistemas prontos\App. Farmacia"
WshShell.Run "node src\server.js", 0, False
