#!/usr/bin/env python
"""
    Socket curve plot script. Example usage of socket_instr
    Tested on MDO3000/4000C and 2/3/4/5(B)/6(B) series platform scopes
    Socket instrument communication program for curve? analog waveform query
    Socket communication is more difficult to debug and lacks the robustness of VISA/VXI-11
    Smaller overhead of sockets provides greater throughput
    socket_instr module required

    Disclaimer:
    Some modifications may be required to run without error.
    This program is a proof of concept and provided "As-is".
    Its contents may be altered to suit different applications.

    Tested using Python v3.10.5
    Author: Steve Guerrero
"""

import numpy as np      # numpy version v1.23.1
import time
from socket_instr import SocketInstr  # socket_instr module required, include socket_instr.py in CWD

# user preferences
plots = False        # set False to disable plots, program is slow to plot 100M+ sample waveforms, uses matplotlib
save2file = True   # Set True to enable scaled waveform data and timing information save to file
save_img = False     # fetches a screen grab from scope
chan_sel = [1]        # selected channels/sources to acquire waveform data


def chan_state(self, sources, enable):  # Enables or disables selected channels
    n = 1 if enable else 0
    for i in sources:
        self.write(f"disp:glob:ch{i}:state {n}")
    return(int(self.query('*opc?')))


def horiz_scale(self):
    pre_trig_record = int(self.query('wfmoutpre:pt_off?'))
    t_scale = float(self.query('wfmoutpre:xincr?'))
    t_sub = float(self.query('wfmoutpre:xzero?'))  # sub-sample trigger correction
    total_time = t_scale * acq_record
    t_start = (-pre_trig_record * t_scale) + t_sub
    t_stop = t_start + total_time
    scaled_time = np.linspace(t_start, t_stop, num=acq_record, endpoint=False)
    return(scaled_time)


def vert_scale(self, bin_wfm):
    # retrieve scaling factors for scaled wave plot
    # this only applies to SRIBINARY, signed ints
    r = int(scope.query('wfmoutpre:byt_n?'))
    if(r == 1):        # 'h' signed 2-Byte int, 'b' signed 1-Byte int. C-struct data type formats: https://docs.python.org/3/library/struct.html#format-characters
        d_typ = 'b'
    elif(r == 2):
        d_typ = 'h'
    bin_wfm = np.frombuffer(bin_wfm, dtype=d_typ)  # converts raw byte array to np array for easier handling
    v_scale = float(self.query('wfmoutpre:ymult?'))  # volts / level
    v_off = float(self.query('wfmoutpre:yzero?'))  # reference voltage
    v_pos = float(self.query('wfmoutpre:yoff?'))  # reference position (level)

    # vertical (voltage)
    unscaled_amp = np.array(bin_wfm, dtype='double')  # data type conversion
    scaled_amp = (unscaled_amp - v_pos) * v_scale + v_off
    return(scaled_amp)


"""     Main Application    """
if __name__ == "__main__":

    scope = SocketInstr('127.0.0.1', 4000, timeout=20)  # Scope IP, Default port = 4000
    scope.clear()
    scope.write('*cls')         # clears event status register

    ID = scope.query('*idn?').split(',')
    model = ID[1]
    serial = ID[2]
    print(f'Connected to: {model}, {serial}')
    chan_state(scope, chan_sel, True)    # False, disables selected channels
    scope.query('*opc?')

    # scope setup
    scope.write('display:waveform OFF')     # turn off on-screen waveform traces for faster transfers, not necessary for <100k points
    scope.write('horizontal:mode MAN')             # manual horizontal mode for record length setting
    scope.query('*opc?')

    scope.write('horizontal:mode:record 750000000')  # set record length
    scope.write('acquire:stopafter RUNStop')        # Run/Stop not reliant on trigger, for demo purposes
    scope.write('acquire:state ON')
    scope.query('*opc?')

    # curve configuration, queries entire record
    scope.write('data:encdg SRIBINARY')                 # signed integer, may need to modify program for other encoding schemes
    scope.write('data:start 1')
    acq_record = int(scope.query('horizontal:recordlength?'))
    scope.write('data:stop {}'.format(acq_record))
    scope.write('wfmoutpre:byt_n 2')            # Bytes per sample, use 1 or 2 for analog channels

    scope.write('acquire:state OFF')
    r = scope.query('*opc?')    # sync
    start_time = time.time()    # beginning of transfer.

    # Curve loop, channels 1 - 8
    for i in chan_sel:
        scope.write('data:source ch{:d}'.format(i))  # only a single source is allowed per curve query
        r = scope.query('*opc?')    # sync

        scope.write('curve?')   # initiates waveform data dump
        bin_wave = scope.read_bin_wave()  # reads binary waveform data from scope buffer
        print(f'Byte length of Ch{i} ', len(bin_wave))

    stop_time = time.time()
    print('time to complete transfer after scope setup/acquisition: ', stop_time - start_time)
    scope.write('display:waveform ON')  # re-enable waveform traces for image save

    # create scaled vectors for file save or plotting
    scaled_time = horiz_scale(scope)
    scaled_amp = vert_scale(scope, bin_wave)

    if save2file is True:   # dumps scaled time array and raw waveform data array to file in CWD
        with open('test.bin', 'wb') as f:
            # np.save(f, scaled_time)
            # np.save(f, scaled_amp)
            np.save(f, bin_wave)    # save binary data to file, needs header for scaling and timing information
            print("time to save:", time.time() - stop_time)

    if save_img is True:    # fetches image from scope and saves to CWD
        from datetime import datetime
        dt = datetime.now()  # timestamp for PC filename
        fname_local = dt.strftime((('{:s}_{:s}_%Y%m%d_%H%M%S.%f')[:-3] + '.png').format(model, serial))  # example: "MSO58B_B025564_20240404_115123.321.png"
        fname_scope = 'temp.png'
        path_scope = scope.query('filesystem:homedir?')
        print('scope dir: {:s}'.format(path_scope))
        scope.write('filesystem:cwd {:s}'.format(path_scope))
        img_data = scope.fetch_screen(fname_scope)
        with open(fname_local, 'wb') as f:
            f.write(img_data)

    # error checking
    print('Event Status Register:', scope.query('*esr?'))
    print("All event codes/messages:", scope.query('allev?'))   # displays event codes and messages, also clears EVMsg? queue
    scope.clear()   # clear buffer

    # close socket
    scope.close()

    if plots is True:
        import matplotlib.pyplot as plt        # (optional) used for plots, version 3.5.2
        # plotting
        plt.plot(scaled_time, scaled_amp)
        plt.title('Channel {:d}'.format(chan_sel[-1]))  # plot label
        plt.xlabel('Time (seconds)')  # x label
        plt.ylabel('Amplitude (volts)')  # y label
        print("look for plot window...")
        plt.show()
