Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\diamo\Desktop\Sistemas prontos\App. Farmacia"
WshShell.Run "python src\server.py", 0, False
