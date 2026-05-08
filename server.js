const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const crypto  = require('crypto');

const app = express();
const srv = http.createServer(app);
const io  = new Server(srv);

// Serve index.html and any other static files from this directory
app.use(express.static(__dirname));

// rooms: Map<id, { players: [{socketId, color}], turn: 1|2, votes: Set }>
const rooms = new Map();

function makeId() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

io.on('connection', socket => {
    let myRoom  = null;
    let myColor = null; // 1 = Red, 2 = Blue

    socket.on('create_room', () => {
        const id = makeId();
        rooms.set(id, { players: [{ id: socket.id, color: 1 }], turn: 1, votes: new Set() });
        myRoom  = id;
        myColor = 1;
        socket.join(id);
        socket.emit('room_created', id);
    });

    socket.on('join_room', raw => {
        const id   = String(raw).toUpperCase().trim();
        const room = rooms.get(id);
        if (!room)                    { socket.emit('join_error', 'Room not found.');  return; }
        if (room.players.length >= 2) { socket.emit('join_error', 'Room is full.');    return; }

        myRoom  = id;
        myColor = 2;
        room.players.push({ id: socket.id, color: 2 });
        socket.join(id);

        // Tell each player their assigned color
        for (const p of room.players) {
            io.to(p.id).emit('game_start', p.color);
        }
    });

    socket.on('drop', col => {
        const room = rooms.get(myRoom);
        if (!room || room.turn !== myColor) return;
        io.to(myRoom).emit('move', col);          // relay to both players
        room.turn = room.turn === 1 ? 2 : 1;      // advance turn
    });

    // Both players must vote before a rematch begins
    socket.on('vote_restart', () => {
        const room = rooms.get(myRoom);
        if (!room) return;
        room.votes.add(socket.id);
        if (room.votes.size >= 2) {
            room.votes.clear();
            room.turn = 1;                         // reset to Red's turn
            io.to(myRoom).emit('game_restart');
        } else {
            socket.to(myRoom).emit('opponent_wants_restart');
        }
    });

    socket.on('disconnect', () => {
        const room = rooms.get(myRoom);
        if (room) {
            socket.to(myRoom).emit('opponent_left');
            rooms.delete(myRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
