import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", 10011))

print("Listening...")

while True:
    data, addr = sock.recvfrom(1024)
    print("Received:", data.decode())