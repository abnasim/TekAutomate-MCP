import { aiChatReducer, initialAiChatState } from './aiChatReducer';

describe('aiChatReducer streaming flow', () => {
  it('creates streaming assistant and appends chunks', () => {
    let state = aiChatReducer(initialAiChatState, {
      type: 'ADD_TURN',
      turn: { role: 'user', content: 'hello', timestamp: 1 },
    });
    state = aiChatReducer(state, { type: 'STREAM_START' });
    state = aiChatReducer(state, { type: 'STREAM_CHUNK', chunk: 'abc' });
    state = aiChatReducer(state, { type: 'STREAM_CHUNK', chunk: 'def' });
    state = aiChatReducer(state, { type: 'STREAM_DONE' });

    const last = state.history[state.history.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('abcdef');
    expect(last.streaming).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('keeps only last 12 turns', () => {
    let state = initialAiChatState;
    for (let i = 0; i < 20; i += 1) {
      state = aiChatReducer(state, {
        type: 'ADD_TURN',
        turn: { role: i % 2 === 0 ? 'user' : 'assistant', content: String(i), timestamp: i },
      });
    }
    expect(state.history.length).toBe(12);
    expect(state.history[0].content).toBe('8');
  });
});

