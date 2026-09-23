import React, { useState } from "react";

const ticLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function gameWinner(board) {
  for (const [a, b, c] of ticLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? "draw" : null;
}

export default function GamesPanel() {
  const [board, setBoard] = useState(() => Array(9).fill(""));
  const [nextPlayer, setNextPlayer] = useState("X");
  const winner = gameWinner(board);
  const status = winner === "draw" ? "Match nul." : winner ? `Le joueur ${winner} a gagné.` : `Au joueur ${nextPlayer} de jouer.`;

  function play(index) {
    if (board[index] || winner) return;
    setBoard((current) => current.map((cell, cellIndex) => cellIndex === index ? nextPlayer : cell));
    setNextPlayer((current) => current === "X" ? "O" : "X");
  }

  return (
    <div className="games-panel">
      <div className="game-head">
        <strong>Tic Tac Toe / Morpion</strong>
        <button type="button" onClick={() => { setBoard(Array(9).fill("")); setNextPlayer("X"); }}>Nouvelle partie</button>
      </div>
      <p className="popup-note">Jeu présent dans MSN Messenger. Deux joueurs sur cet ordinateur; aucune session avec Codex n’est créée.</p>
      <div className="tic-grid" role="group" aria-label="Plateau de morpion">
        {board.map((cell, index) => (
          <button
            className={cell ? `tic-cell ${cell.toLowerCase()}` : "tic-cell"}
            type="button"
            key={index}
            onClick={() => play(index)}
            disabled={Boolean(cell) || Boolean(winner)}
            aria-label={`Case ${index + 1}: ${cell || "vide"}`}
          >
            {cell ? <img src={`./msn-assets/games/piece-${cell.toLowerCase()}.png`} alt={cell} draggable="false" /> : null}
          </button>
        ))}
      </div>
      <p className="game-status" role="status">{status}</p>
    </div>
  );
}
