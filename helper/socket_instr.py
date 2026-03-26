#!/usr/bin/env python
'''
Robust Socket methods with attempt to mimic common pyvisa methods and behaviors,
along with easy to use functions such as read binary waveforms, and image fetching.
Uses only python built-in modules for portability
Tested on MDO3000/4000C and 2/3/4/5(B)/6(B) series platform scopes
    
    Disclaimer:
    This program is a proof of concept and provided "As-is".
    Its contents may be altered to suit different applications.

    Tested using Python v3.10.5
    Author: Steve Guerrero
'''

import socket
import sys
import re


''' Methods for instrument socket connection and data transfer '''


class SocketInstr(object):
    def __init__(self, host, port, timeout=10):     # Initialization of socket object

        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)     # AF_INET = IPV4, SOCK_STREAM = TCP
        try:
            self.socket.connect((host, port))   # Attempt connection to instrument (IPV4 address, socket port)
            self.socket.setblocking(False)      # non-blocking is best for asynchronous communication
            self.socket.settimeout(timeout)     # default timeout set to 10 seconds
        except socket.error as msg:             # error checking
            print("Error: could not create socket")
            print("Description: " + str(msg))
            sys.exit()

    def close(self):   # socket closing function

        self.socket.shutdown(socket.SHUT_RDWR)  # informs server (instrument) prior to closure
        self.socket.close()

    def read(self):         # socket data receive method, decodes to ASCII string

        try:
            resp = self.socket.recv(1024)       # default 1KiB
            while resp[-1:] != b'\n':           # check for EOL linefeed char
                resp += self.socket.recv(1024)  # receive and append more data
            resp = resp.decode('latin_1').strip()   # convert Bytes to string
        except socket.error as msg:
            print("Error: unable to recv()")
            print("Description: " + str(msg))
            sys.exit()
        return resp  # return response from instrument

    def write(self, scpi):  # Socket Write SCPI to instrument method, encodes string to bytes

        scpi = f'{scpi}\n'.encode('latin_1')    # convert string to Bytes prior to send
        try:
            self.socket.sendall(scpi)   # send Bytes
        except socket.error as msg:
            print("Error: send() failed")
            print("Description: " + str(msg))
            sys.exit()

    def query(self, scpi):  # Socket Query SCPI from instrument, references both write and read functions

        self.write(scpi)
        resp = self.read()
        return resp         # return response from instrument

    def read_bytes(self, n_bytes):  # reads raw data, requires byte length as argument

        raw_data = bytearray(n_bytes)  # Initialize byte array of N-length
        mv = memoryview(raw_data)     # object 'raw_data' spliced for much faster manipulation. 'mv' points to 'raw_data' object in memory
        try:
            while n_bytes:     # While data remains
                c = self.socket.recv_into(mv, n_bytes)   # recv n_bytes into mv, c = num bytes recvd
                mv = mv[c:]     # appends n_bytes received to mv object
                n_bytes -= c    # removes number of bytes read from mv
        except socket.error as msg:
            print("Error: unable to recv()")
            print("Description: " + str(msg))
            sys.exit()
        return raw_data

    def clear(self):        # behaves like pyvisa device.clear(), used for debugging
        self.write('!d')    # device clear flag for supported instruments

    ''' Instrument specific functions '''

    def read_bin_wave(self):   # IEEE Binary block header parsing and waveform reading function, references read_bytes()

        # first we need to read and parse binary block header by format represented by example: (#72500000[Bytes of binary data]\n)
        bin_header = self.read_bytes(18)           # first 18 Bytes should contain all binary block header information in any case, tested to 1 Gpts
        byte_len = int(bin_header.decode('latin_1').strip()[1], base=16)        # 2nd character representing number of bytes, base 16 representation
        num_bytes = int(bin_header.decode('latin_1').strip()[2:byte_len + 2])   # num_bytes of waveform data to read after header
        rem = bin_header[byte_len + 2:]             # remaining bytes from header to be included in returned waveform data

        wave_data = rem + self.read_bytes(num_bytes - len(rem) + 1)    # '+1' accounts for linefeed character
        return wave_data[:-1]   # return waveform data without linefeed character

    # Robust image fetch sequence for 2/3/4/5(B)/6(B) series platform

    def dir_info(self):  # finds saved image directory
        r = self.query('filesystem:ldir?')
        a = re.findall(r'[^,;"]+', r)
        b = [a[i:i + 5] for i in range(0, len(a), 5)]
        return b

    def get_file_size(self, file):  # gets file sizing from scope for correct read buffer sizing through socket
        r = self.dir_info()
        a = [i for i, x in enumerate(r) if x[0] == file]
        if len(a) == 0:
            p = self.query('filesystem:cwd?')
            error_message = f'file "{file}" not found on scope (path: {p})'
            raise Exception(error_message)
        size = int(r[a[0]][2])
        return size

    def fetch_screen(self, temp_file):  # saves temp file on scope, retrieves it, then deletes it to save disk space.
        """get screen from 5/6 series scope"""
        self.write(f'save:image "{temp_file}"')
        self.query('*opc?')
        size = self.get_file_size(temp_file)
        cmd = f'filesystem:readfile "{temp_file}"\n'
        self.socket.send(cmd.encode('latin_1'))
        self.socket.send(b'!r\n')  # Flag for scope read to buffer
        dat = self.read_bytes(size)
        r = self.socket.recv(512)
        if r != b'\n':
            error_message = 'file bytes request did not end with linefeed. file likely corrupted'
            raise Exception(error_message)
        self.write(f'filesystem:delete "{temp_file}"')
        self.query('*opc?')
        return dat
