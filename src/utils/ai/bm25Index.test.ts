import { Bm25Index } from './bm25Index';

describe('Bm25Index', () => {
  it('returns most relevant chunk first', () => {
    const index = new Bm25Index([
      { id: 'a', corpus: 'scpi', title: 'IDN query', body: '*IDN? identity query' },
      { id: 'b', corpus: 'scpi', title: 'Acquire mode', body: 'ACQuire:MODe' },
    ]);
    const res = index.search('idn query', 2);
    expect(res[0].id).toBe('a');
  });
});

