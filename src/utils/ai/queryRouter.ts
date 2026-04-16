import type { RagCorpus, RetrievalPlan } from './types';

const ROUTER_SIGNALS: Array<{ corpus: RagCorpus; pattern: RegExp; reason: string }> = [
  {
    corpus: 'tmdevices',
    pattern: /tm_devices|device_manager|add_scope|verify_|set_and_verify|\.commands\.|scope\d*\.commands/i,
    reason: 'tm_devices API usage',
  },
  {
    corpus: 'scpi',
    pattern: /measurement|trigger|acquire|channel|filesystem|tcpip|gpib|usb::|\*idn\?|\*opc\?|fastframe|framerate|horizontal:fastframe/i,
    reason: 'SCPI command intent',
  },
  {
    corpus: 'pyvisa_tekhsi',
    pattern: /pyvisa|tekhsi|vxi11|grpc|port\s*5000|hislip|socket/i,
    reason: 'transport/backend protocol intent',
  },
  {
    corpus: 'errors',
    pattern: /fail|timeout|invalid|hang|abort|violation|conflict|traceback|exception|error/i,
    reason: 'execution/runtime errors',
  },
  {
    corpus: 'templates',
    pattern: /\.tss|recall|template|session|export|import/i,
    reason: 'template/session workflow',
  },
  {
    corpus: 'app_logic',
    pattern: /blockly|block|xml|mutation|toolbox|workspace|backend|pyvisa|vxi11|tekhsi|hybrid|connection/i,
    reason: 'app/backend behavior',
  },
  {
    corpus: 'scope_logic',
    pattern: /clipping|clip|9\.91e\+37|overshoot|ringing|signal integrity|probe comp|probe compensation|setup scope|autoset|auto setup|optimize display/i,
    reason: 'scope procedure intent',
  },
];

const BUILD_SIGNALS = /build|create|generate|compose|setup|configure|capture|measure|workflow|flow|steps|blockly|json|xml/i;

export function routeQuery(message: string, hintCorpora: RagCorpus[] = []): RetrievalPlan {
  const corpora = new Set<RagCorpus>(['app_logic']);
  const reasons: string[] = ['always include app_logic policy'];

  hintCorpora.forEach((c) => corpora.add(c));
  if (hintCorpora.length) {
    reasons.push('predefined action corpus hint');
  }

  ROUTER_SIGNALS.forEach(({ corpus, pattern, reason }) => {
    if (pattern.test(message)) {
      corpora.add(corpus);
      reasons.push(reason);
    }
  });

  if (BUILD_SIGNALS.test(message)) {
    ['scpi', 'tmdevices', 'templates', 'pyvisa_tekhsi'].forEach((c) => corpora.add(c as RagCorpus));
    reasons.push('builder intent: force multi-corpus retrieval');
  }

  if (!Array.from(corpora).some((c) => c === 'scpi' || c === 'tmdevices')) {
    corpora.add('scpi');
    reasons.push('default scpi retrieval fallback');
  }

  return {
    corpora: Array.from(corpora),
    reasons,
  };
}
