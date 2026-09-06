"""EWMH activation of an X11 window belonging to a specified test process."""
import ctypes
import re
import subprocess
import sys

pid = int(sys.argv[1])
root_info = subprocess.check_output(['xprop', '-root', '_NET_CLIENT_LIST'], text=True, timeout=1)
windows = []
for value in re.findall(r'0x[0-9a-f]+', root_info):
    info = subprocess.check_output(['xprop', '-id', value, '_NET_WM_PID'], text=True, timeout=1)
    if info.strip().endswith('= ' + str(pid)):
        windows.append(int(value, 16))
if not windows:
    raise SystemExit(1)

# Layouts match Xlib.h; XEvent is padded to 24 native longs.
class Data(ctypes.Union):
    _fields_ = [('b', ctypes.c_char * 20), ('s', ctypes.c_short * 10), ('l', ctypes.c_long * 5)]
class ClientMessage(ctypes.Structure):
    _fields_ = [('type', ctypes.c_int), ('serial', ctypes.c_ulong), ('send_event', ctypes.c_int),
        ('display', ctypes.c_void_p), ('window', ctypes.c_ulong), ('message_type', ctypes.c_ulong), ('format', ctypes.c_int), ('data', Data)]
class Event(ctypes.Union):
    _fields_ = [('client', ClientMessage), ('pad', ctypes.c_long * 24)]

x11 = ctypes.CDLL('libX11.so.6')
x11.XOpenDisplay.argtypes = [ctypes.c_char_p];x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p];x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int];x11.XInternAtom.restype = ctypes.c_ulong
x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.POINTER(Event)]
x11.XFlush.argtypes = [ctypes.c_void_p];x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit(1)
try:
    for window in windows:
        event = Event();event.client.type = 33;event.client.send_event = 1;event.client.display = display
        event.client.window = window;event.client.message_type = x11.XInternAtom(display, b'_NET_ACTIVE_WINDOW', 0);event.client.format = 32
        event.client.data.l[0] = 2  # Pager/user-initiated activation, never an arbitrary keyboard event.
        event.client.data.l[1] = 0
        x11.XSendEvent(display, x11.XDefaultRootWindow(display), 0, (1 << 19) | (1 << 20), ctypes.byref(event))
    x11.XFlush(display)
finally:
    x11.XCloseDisplay(display)
