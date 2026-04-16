import { routeQuery } from './queryRouter';

describe('routeQuery', () => {
  it('routes tm_devices and scpi together when both signals present', () => {
    const plan = routeQuery('tm_devices verify_trigger failed for MEASUrement query');
    expect(plan.corpora).toEqual(expect.arrayContaining(['tmdevices', 'scpi', 'errors', 'app_logic']));
  });

  it('includes hinted corpora', () => {
    const plan = routeQuery('check this', ['templates']);
    expect(plan.corpora).toContain('templates');
  });

  it('routes transport questions to pyvisa_tekhsi corpus', () => {
    const plan = routeQuery('vxi11 timeout on grpc port 5000 with tekhsi');
    expect(plan.corpora).toContain('pyvisa_tekhsi');
  });

  it('forces multi-corpus retrieval for builder intent', () => {
    const plan = routeQuery('build me a flow to capture measurements and screenshot in json');
    expect(plan.corpora).toEqual(
      expect.arrayContaining(['scpi', 'tmdevices', 'templates', 'pyvisa_tekhsi', 'app_logic'])
    );
  });

  it('routes fastframe command lookup to scpi corpus', () => {
    const plan = routeQuery('what is fastframe command?');
    expect(plan.corpora).toContain('scpi');
  });
});
