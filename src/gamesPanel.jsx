import React, { useEffect, useState } from "react";
import { Logo } from "./windowChrome.jsx";

const gamePrompts = [
  ["Bug Hunt", "Lance un mini-jeu Bug Hunt: donne-moi un fichier ou une zone a inspecter, puis guide-moi pour trouver le bug avant de proposer la correction."],
  ["20 Questions", "Lance un jeu de 20 questions pour clarifier une feature du projet avant implementation."],
  ["Code Golf", "Choisis une petite amelioration du projet et transforme-la en defi code golf lisible, puis propose la solution propre."],
  ["XP Polish", "Lance un defi XP Polish: trouve trois details visuels qui trahissent une UI moderne et corrige-les un par un."]
];

const gameCatalog = [
  { id: "morpion", label: "Morpion" },
  { id: "memory", label: "Memory" },
  { id: "wizz", label: "Wizz" }
];

const gameAssets = {
  x: "./msn-assets/games/piece-x.png",
  o: "./msn-assets/games/piece-o.png",
  bell: "./msn-assets/games/bell.png"
};

const memorySymbols = [
  { id: "smile", label: "Smile", src: "./msn-assets/games/smile.png" },
  { id: "gift", label: "Gift", src: "./msn-assets/games/gift.png" },
  { id: "butterfly", label: "Butterfly", src: "./msn-assets/games/butterfly.png" },
  { id: "bell", label: "Wizz", src: "./msn-assets/games/bell.png" },
  { id: "person", label: "Buddy", src: "./msn-assets/games/person.png" },
  { id: "group", label: "Group", src: "./msn-assets/games/group.png" }
];

const ticLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function gameWinner(board) {
  for (const [a, b, c] of ticLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function chooseCodexMove(board) {
  const empty = board.map((cell, index) => cell ? null : index).filter((index) => index !== null);
  const testMove = (mark) => empty.find((index) => {
    const next = [...board];
    next[index] = mark;
    return gameWinner(next) === mark;
  });
  return testMove("O") ?? testMove("X") ?? (board[4] ? null : 4) ?? [0, 2, 6, 8].find((index) => !board[index]) ?? empty[0] ?? null;
}

function createMemoryDeck() {
  return memorySymbols
    .flatMap((symbol) => [symbol, symbol])
    .sort(() => Math.random() - 0.5)
    .map((symbol, index) => ({ id: `${symbol.id}-${index}-${Math.random()}`, symbol, matched: false }));
}

function nextReflexTarget(current = -1) {
  let next = Math.floor(Math.random() * 9);
  if (next === current) next = (next + 1) % 9;
  return next;
}

export default function GamesPanel({ activeGame, onSelectGame, onRun, waiting }) {
  return (
    <div className="games-panel">
      <div className={waiting ? "game-presence thinking" : "game-presence"}>
        <Logo small />
        <span>{waiting ? "Codex reflechit..." : "Codex joue aussi"}</span>
      </div>
      <div className="game-tabs">
        {gameCatalog.map((game) => (
          <button className={activeGame === game.id ? "active" : ""} type="button" key={game.id} onClick={() => onSelectGame(game.id)}>
            {game.label}
          </button>
        ))}
      </div>
      {activeGame === "morpion" ? <TicTacToeGame /> : null}
      {activeGame === "memory" ? <MemoryGame /> : null}
      {activeGame === "wizz" ? <WizzReflexGame /> : null}
      <div className="chat-game-prompts">
        <button type="button" onClick={() => onRun(gamePrompts[Math.floor(Math.random() * gamePrompts.length)][1])}>Defi chat Codex</button>
      </div>
    </div>
  );
}

function TicTacToeGame() {
  const [board, setBoard] = useState(Array(9).fill(""));
  const [status, setStatus] = useState("A toi de jouer.");
  const [codexThinking, setCodexThinking] = useState(false);
  const winner = gameWinner(board);

  function reset() {
    setBoard(Array(9).fill(""));
    setStatus("A toi de jouer.");
    setCodexThinking(false);
  }

  function play(index) {
    if (board[index] || winner || codexThinking) return;
    const playerBoard = [...board];
    playerBoard[index] = "X";
    const playerWinner = gameWinner(playerBoard);
    setBoard(playerBoard);
    if (playerWinner === "X") {
      setStatus("Tu gagnes contre Codex.");
      return;
    }
    if (playerWinner === "draw") {
      setStatus("Match nul.");
      return;
    }
    setCodexThinking(true);
    setStatus("Codex joue...");
    window.setTimeout(() => {
      const move = chooseCodexMove(playerBoard);
      const codexBoard = [...playerBoard];
      if (move !== null) codexBoard[move] = "O";
      const result = gameWinner(codexBoard);
      setBoard(codexBoard);
      setCodexThinking(false);
      if (result === "O") setStatus("Codex gagne cette manche.");
      else if (result === "draw") setStatus("Match nul.");
      else setStatus("A toi de jouer.");
    }, 380);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Morpion</strong><button type="button" onClick={reset}>New</button></div>
      <div className="tic-grid">
        {board.map((cell, index) => (
          <button className={cell ? `tic-cell ${cell.toLowerCase()}` : "tic-cell"} type="button" key={index} onClick={() => play(index)} disabled={Boolean(cell) || Boolean(winner) || codexThinking}>
            {cell === "X" ? <img src={gameAssets.x} alt="X" /> : null}
            {cell === "O" ? <img src={gameAssets.o} alt="O" /> : null}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}

function MemoryGame() {
  const [deck, setDeck] = useState(createMemoryDeck);
  const [open, setOpen] = useState([]);
  const [moves, setMoves] = useState(0);
  const [status, setStatus] = useState("Trouve les paires Codex.");

  function reset() {
    setDeck(createMemoryDeck());
    setOpen([]);
    setMoves(0);
    setStatus("Trouve les paires Codex.");
  }

  function flip(index) {
    if (open.length === 2 || open.includes(index) || deck[index].matched) return;
    const nextOpen = [...open, index];
    setOpen(nextOpen);
    if (nextOpen.length !== 2) return;
    setMoves((current) => current + 1);
    const [first, second] = nextOpen;
    if (deck[first].symbol.id === deck[second].symbol.id) {
      const nextDeck = deck.map((card, cardIndex) => cardIndex === first || cardIndex === second ? { ...card, matched: true } : card);
      setDeck(nextDeck);
      setOpen([]);
      setStatus(nextDeck.every((card) => card.matched) ? "Toutes les paires sont trouvees." : "Paire trouvee.");
      return;
    }
    setStatus("Codex a vu la paire. Reessaie.");
    window.setTimeout(() => setOpen([]), 650);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Memory</strong><button type="button" onClick={reset}>New</button></div>
      <div className="memory-grid">
        {deck.map((card, index) => {
          const visible = card.matched || open.includes(index);
          return (
            <button className={visible ? "memory-card visible" : "memory-card"} type="button" key={card.id} onClick={() => flip(index)}>
              {visible ? <img src={card.symbol.src} alt={card.symbol.label} /> : <img src="./msn-assets/games/game-card.png" alt="?" />}
            </button>
          );
        })}
      </div>
      <p className="game-status">{status} Coups: {moves}</p>
    </section>
  );
}

function WizzReflexGame() {
  const [target, setTarget] = useState(() => nextReflexTarget());
  const [score, setScore] = useState({ me: 0, codex: 0 });
  const [running, setRunning] = useState(true);
  const [status, setStatus] = useState("Clique le Wizz avant Codex.");

  useEffect(() => {
    if (!running) return undefined;
    const timeout = window.setTimeout(() => {
      setScore((current) => {
        const codex = current.codex + 1;
        if (codex >= 10) {
          setRunning(false);
          setStatus("Codex gagne au reflexe.");
        } else {
          setStatus("Codex marque.");
          setTarget((currentTarget) => nextReflexTarget(currentTarget));
        }
        return { ...current, codex };
      });
    }, 1900);
    return () => window.clearTimeout(timeout);
  }, [target, running]);

  function reset() {
    setScore({ me: 0, codex: 0 });
    setTarget(nextReflexTarget());
    setRunning(true);
    setStatus("Clique le Wizz avant Codex.");
  }

  function hit(index) {
    if (!running || index !== target) return;
    setScore((current) => {
      const me = current.me + 1;
      if (me >= 10) {
        setRunning(false);
        setStatus("Tu gagnes le Wizz Reflex.");
      } else {
        setStatus("Point pour toi.");
        setTarget((currentTarget) => nextReflexTarget(currentTarget));
      }
      return { ...current, me };
    });
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Wizz Reflex</strong><button type="button" onClick={reset}>New</button></div>
      <div className="game-score"><span>Toi {score.me}</span><span>Codex {score.codex}</span></div>
      <div className="reflex-grid">
        {Array.from({ length: 9 }).map((_, index) => (
          <button className={index === target && running ? "reflex-cell target" : "reflex-cell"} type="button" key={index} onClick={() => hit(index)}>
            {index === target && running ? <img src={gameAssets.bell} alt="Wizz" /> : null}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}
