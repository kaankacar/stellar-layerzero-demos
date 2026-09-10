import { useState } from 'react';
import { motion } from 'framer-motion';

interface Q {
  q: string;
  options: { text: string; correct?: boolean; feedback: string }[];
}
const QUESTIONS: Q[] = [
  {
    q: 'You send 25 USDT0 from Stellar to Arbitrum. What happens to your 25 USDT0 on Stellar?',
    options: [
      { text: 'They are locked inside the OFT contract until someone sends them back.', feedback: 'That is the Ethereum adapter\'s trick, not Stellar\'s. Stellar\'s OFT is MintBurn.' },
      { text: 'They are burned via the SAC; Arbitrum mints 25.', correct: true, feedback: 'Exactly. oft_type = MintBurn: burn here, mint there, total supply unchanged.' },
      { text: 'They are sent to the issuer account.', feedback: 'The issuer is locked (master weight 0) and never touches tokens. Nice try though.' },
    ],
  },
  {
    q: 'You type 1.0000005 USDT0 into a send. On a no-fee route, what does quote_oft say arrives?',
    options: [
      { text: '1.0000005', feedback: 'The wire format only has 6 shared decimals; that 5 has nowhere to go.' },
      { text: '1.000000, and the 0.0000005 stays in your account', correct: true, feedback: 'Right: dust below decimal_conversion_rate (10) is floored off before the message is built.' },
      { text: '1.000001 (it rounds up)', feedback: 'OFTs floor, never round up: nobody may receive more than was debited.' },
    ],
  },
  {
    q: 'A USDT0 message arrives at Stellar from Ethereum. Who must attest before it can execute?',
    options: [
      { text: 'Any one of the DVNs registered on Stellar', feedback: 'Registration is not selection. Each OApp picks its own required set.' },
      { text: 'All of the DVNs USDT0 configured as required (LayerZero Labs, Canary, USDT0)', correct: true, feedback: 'Yes. The ULN config is per application: every required DVN must sign the same packet header + payload hash.' },
      { text: 'Stellar\'s validators', feedback: 'Stellar validators finalize Stellar ledgers; they know nothing about LayerZero packets.' },
    ],
  },
  {
    q: 'Which contract actually mints USDT0 on Stellar when the message is delivered?',
    options: [
      { text: 'The OFT contract mints on the SAC directly', feedback: 'The OFT is not the SAC admin. It has to go through the manager.' },
      { text: 'The SAC-manager, called by the OFT, which holds MINTER_ROLE', correct: true, feedback: 'Correct. SAC.admin() is the SAC-manager; the OFT holds MINTER_ROLE and calls mint(to, amount, operator = OFT).' },
      { text: 'The issuer account pays the recipient', feedback: 'A payment from the issuer would mint, which is exactly why the issuer\'s master key has weight 0.' },
    ],
  },
];

export function Quiz() {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const score = QUESTIONS.filter((q, i) => answers[i] !== undefined && q.options[answers[i]!]?.correct).length;
  const done = Object.keys(answers).length === QUESTIONS.length;
  return (
    <div className="space-y-4">
      {QUESTIONS.map((q, i) => {
        const picked = answers[i];
        return (
          <div key={i} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 text-sm font-semibold">{i + 1}. {q.q}</div>
            <div className="grid gap-2">
              {q.options.map((o, j) => {
                const isPicked = picked === j;
                const reveal = picked !== undefined;
                const cls = reveal && o.correct ? 'border-ok/60 bg-ok/10' : isPicked ? 'border-danger/60 bg-danger/10' : 'border-border bg-surface-2 hover:border-accent';
                return (
                  <button key={j} className={`rounded-lg border p-2 text-left text-sm transition ${cls}`} onClick={() => setAnswers((a) => ({ ...a, [i]: j }))} disabled={reveal}>
                    <div>{o.text}</div>
                    {reveal && (isPicked || o.correct) ? (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className={`mt-1 text-xs ${o.correct ? 'text-ok' : 'text-danger'}`}>
                        {o.correct ? '✓ ' : '✗ '}{o.feedback}
                      </motion.div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {done ? (
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-xl border border-accent/50 bg-accent/10 p-4 text-center">
          <div className="text-2xl font-bold">{score} / {QUESTIONS.length}</div>
          <div className="text-sm text-muted">{score === QUESTIONS.length ? 'Flawless. Go build an OFT.' : score >= 2 ? 'Solid. The Inspector page will fill the gaps.' : 'The explainer above is happy to be re-read.'}</div>
          <button className="btn mt-2" onClick={() => setAnswers({})}>retry</button>
        </motion.div>
      ) : null}
    </div>
  );
}
