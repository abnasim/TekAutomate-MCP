import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { handleDialogs } from './helpers';

const E2E_OUTPUT_DIR = path.join(process.cwd(), 'e2e-output');

type Backend = 'pyvisa' | 'tm_devices' | 'vxi11' | 'hybrid';

function makeDevices(targetBackend: Backend) {
  return [
    {
      id: 'scope1-id',
      alias: 'scope1',
      deviceType: 'SCOPE',
      backend: targetBackend,
      enabled: true,
      connectionType: 'tcpip',
      host: '192.168.1.10',
      port: 5000,
      timeout: 5000,
      visaBackend: 'system',
      deviceDriver: 'MSO6B',
    },
    {
      id: 'awg2-id',
      alias: 'awg2',
      deviceType: 'AWG',
      backend: 'pyvisa',
      enabled: true,
      connectionType: 'tcpip',
      host: '192.168.1.20',
      port: 5000,
      timeout: 5000,
      visaBackend: 'system',
    },
  ];
}

function makeSteps() {
  return [
    {
      id: 'connect-1',
      type: 'connect',
      label: 'Connect to scope1',
      params: {
        instrumentId: 'scope1-id',
        instrumentIds: [],
        printIdn: true,
      },
    },
    {
      id: 'write-1',
      type: 'write',
      label: 'Reset',
      params: {
        command: '*RST',
      },
      boundDeviceId: 'scope1-id',
    },
  ];
}

async function gotoBuilderWithState(page: any, backend: Backend) {
  handleDialogs(page);
  const devices = makeDevices(backend);
  const steps = makeSteps();
  const config = {
    connectionType: 'tcpip',
    host: '192.168.1.10',
    port: 5000,
    usbVendorId: '0x0699',
    usbProductId: '0x0522',
    usbSerial: '',
    gpibBoard: 0,
    gpibAddress: 1,
    backend,
    timeout: 5.0,
    modelFamily: 'MSO4/5/6 Series',
    deviceType: 'SCOPE',
    deviceDriver: 'MSO6B',
    alias: 'scope1',
    visaBackend: 'system',
    tekhsiDevice: '6 Series MSO',
  };

  await page.addInitScript(
    ({ devicesState, stepsState, configState }) => {
      localStorage.setItem('tekautomate_wizard_shown', 'true');
      localStorage.setItem('tekautomate_tour_completed', 'true');
      localStorage.setItem('tek_automator_auth', 'granted');
      localStorage.setItem('tekautomate_devices', JSON.stringify(devicesState));
      localStorage.setItem('tekautomate_steps', JSON.stringify(stepsState));
      localStorage.setItem('tekautomate_config', JSON.stringify(configState));
    },
    { devicesState: devices, stepsState: steps, configState: config }
  );

  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function exportPython(page: any, filename: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 7000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).click();
  const download = await downloadPromise;
  const outPath = path.join(E2E_OUTPUT_DIR, filename);
  fs.mkdirSync(E2E_OUTPUT_DIR, { recursive: true });
  await download.saveAs(outPath);
  return fs.readFileSync(outPath, 'utf-8');
}

test.describe('connect selection + backend code coverage', () => {
  const backends: Backend[] = ['pyvisa', 'tm_devices', 'vxi11', 'hybrid'];

  for (const backend of backends) {
    test(`connect selection respected for ${backend}`, async ({ page }) => {
      await gotoBuilderWithState(page, backend);
      const code = await exportPython(page, `connect-${backend}.py`);

      // Connect step selected scope1 only, so awg2 should not be connected.
      expect(code).toContain(`# Connect scope1 (${backend})`);
      expect(code).not.toContain('# Connect awg2 (pyvisa)');

      if (backend === 'pyvisa') {
        expect(code).toContain('rm_scope1 = pyvisa.ResourceManager()');
        expect(code).toContain("open_resource('TCPIP::192.168.1.10::INSTR')");
      } else if (backend === 'tm_devices') {
        expect(code).toContain('dm_scope1 = DeviceManager(verbose=False)');
        expect(code).toContain("add_scope('TCPIP::192.168.1.10::INSTR')");
      } else if (backend === 'vxi11') {
        expect(code).toContain("devices['scope1'] = vxi11.Instrument('192.168.1.10')");
      } else if (backend === 'hybrid') {
        expect(code).toContain('rm_scope1 = pyvisa.ResourceManager()');
        expect(code).toContain("devices['scope1_hsi_host'] = '192.168.1.10'");
      }
    });
  }
});

