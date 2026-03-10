const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config(); // Cargar variables de entorno

// --- Dependencias de la Base de Datos (MySQL) ---
const mysql = require('mysql2/promise');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3003;

// Variable global para la conexión a la base de datos
let db;

// --- Middlewares ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Lógica de la Base de Datos (MySQL) ---

async function inicializarDb() {
    try {
        // Conexión inicial para crear la base de datos si no existe
        const tempConnection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        });
        await tempConnection.query(`CREATE DATABASE IF NOT EXISTS 
partyfun
;`);
        await tempConnection.end();

        // Conexión principal a la base de datos 'partyfun'
        db = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Crear las tablas si no existen.
        await db.execute(`
            CREATE TABLE IF NOT EXISTS paquetes (
                id VARCHAR(36) PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                ownerId VARCHAR(255) NOT NULL,
                abierto BOOLEAN NOT NULL,
                creadoEn DATETIME NOT NULL
            );
        `);
        
        await db.execute(`
            CREATE TABLE IF NOT EXISTS palabras (
                id INT PRIMARY KEY AUTO_INCREMENT,
                texto TEXT NOT NULL,
                addedBy VARCHAR(255) NOT NULL,
                timestamp DATETIME NOT NULL,
                paqueteId VARCHAR(36) NOT NULL,
                FOREIGN KEY(paqueteId) REFERENCES paquetes(id) ON DELETE CASCADE
            );
        `);
        
        console.log('✅ Conexión con la base de datos MySQL establecida y tablas aseguradas.');
    } catch (error) {
        console.error('🚨 Error fatal al inicializar la base de datos MySQL:', error);
        process.exit(1); // Si la BDD no funciona, la app no puede continuar.
    }
}

// --- API Endpoints (Adaptados para MySQL) ---

// GET /api/paquetes - Listar todos los paquetes
app.get('/api/paquetes', async (req, res) => {
    try {
        const [paquetes] = await db.query(`
            SELECT
                p.id,
                p.nombre,
                p.ownerId,
                p.abierto,
                COUNT(w.id) as numPalabras
            FROM
                paquetes p
            LEFT JOIN
                palabras w ON p.id = w.paqueteId
            GROUP BY
                p.id, p.nombre, p.ownerId, p.abierto
        `);
        res.json(paquetes.map(p => ({ ...p, abierto: !!p.abierto })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al leer los paquetes de la base de datos." });
    }
});

// DELETE /api/paquetes/:paqueteId
app.delete('/api/paquetes/:paqueteId', async (req, res) => {
    const { paqueteId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ message: "Falta el ID de usuario." });

    try {
        const [[paquete]] = await db.query('SELECT ownerId, nombre FROM paquetes WHERE id = ?', [paqueteId]);
        if (!paquete) return res.status(404).json({ message: "Paquete no encontrado." });
        if (paquete.ownerId !== userId) return res.status(403).json({ message: "Solo el creador puede eliminarlo." });

        await db.query('DELETE FROM paquetes WHERE id = ?', [paqueteId]);

        io.emit('paquete_eliminado', { paqueteId, nombrePaquete: paquete.nombre, deletedBy: userId });
        res.status(200).json({ message: `Paquete '${paquete.nombre}' eliminado.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar el paquete." });
    }
});

// POST /api/paquetes - Crear un nuevo paquete
app.post('/api/paquetes', async (req, res) => {
    const { nombre, creadorId } = req.body;
    if (!nombre || !nombre.trim() || !creadorId) {
        return res.status(400).json({ message: "Nombre y creadorId son obligatorios." });
    }

    const nuevoPaquete = {
        id: uuidv4(),
        nombre: nombre.trim(),
        ownerId: creadorId,
        abierto: true,
        creadoEn: new Date()
    };

    try {
        await db.query(
            'INSERT INTO paquetes (id, nombre, ownerId, abierto, creadoEn) VALUES (?, ?, ?, ?, ?)',
            [nuevoPaquete.id, nuevoPaquete.nombre, nuevoPaquete.ownerId, nuevoPaquete.abierto, nuevoPaquete.creadoEn]
        );
        res.status(201).json({ ...nuevoPaquete, palabras: [] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al crear el paquete." });
    }
});

// GET /api/paquetes/:paqueteId - Obtener un paquete con sus palabras
app.get('/api/paquetes/:paqueteId', async (req, res) => {
    const { paqueteId } = req.params;
    try {
        const [[paquete]] = await db.query('SELECT * FROM paquetes WHERE id = ?', [paqueteId]);
        if (!paquete) return res.status(404).json({ message: "Paquete no encontrado." });

        const [palabras] = await db.query('SELECT texto, addedBy, timestamp FROM palabras WHERE paqueteId = ? ORDER BY timestamp ASC', [paqueteId]);
        
        paquete.abierto = !!paquete.abierto;
        paquete.palabras = palabras;

        res.json(paquete);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener el paquete." });
    }
});

// PUT /api/paquetes/:paqueteId/palabras - Añadir una palabra
app.put('/api/paquetes/:paqueteId/palabras', async (req, res) => {
    const { paqueteId } = req.params;
    const { palabra, userId } = req.body;

    if (!palabra || !palabra.trim() || !userId) {
        return res.status(400).json({ message: "Faltan datos." });
    }

    try {
        const [[paquete]] = await db.query('SELECT ownerId, abierto FROM paquetes WHERE id = ?', [paqueteId]);
        if (!paquete) return res.status(404).json({ message: "Paquete no encontrado." });

        // Authorization: Allow if the package is open, or if the user is the owner.
        if (!paquete.abierto && paquete.ownerId !== userId) {
            return res.status(403).json({ message: "Este paquete está cerrado y no eres el creador." });
        }
        
        const palabraTrimmedLower = palabra.trim().toLowerCase();
        const [[palabraExistente]] = await db.query('SELECT 1 FROM palabras WHERE paqueteId = ? AND lower(texto) = ?', [paqueteId, palabraTrimmedLower]);
        if (palabraExistente) return res.status(409).json({ message: "Esta palabra ya existe." });

        const nuevaPalabraObjeto = {
            texto: palabra.trim(),
            addedBy: userId,
            timestamp: new Date()
        };

        await db.query('INSERT INTO palabras (texto, addedBy, timestamp, paqueteId) VALUES (?, ?, ?, ?)',
            [nuevaPalabraObjeto.texto, nuevaPalabraObjeto.addedBy, nuevaPalabraObjeto.timestamp, paqueteId]
        );
        
        io.to(paqueteId).emit('palabra_anadida', { paqueteId, palabraObjeto: nuevaPalabraObjeto });
        res.status(200).json({ message: "Palabra añadida.", palabraObjeto: nuevaPalabraObjeto });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al añadir la palabra." });
    }
});

// PUT /api/paquetes/:paqueteId/estado - Abrir/Cerrar paquete
app.put('/api/paquetes/:paqueteId/estado', async (req, res) => {
    const { paqueteId } = req.params;
    const { abierto, userId } = req.body;

    if (typeof abierto !== 'boolean' || !userId) {
        return res.status(400).json({ message: "Faltan datos." });
    }
    
    try {
        const [result] = await db.query('UPDATE paquetes SET abierto = ? WHERE id = ? AND ownerId = ?',
            [abierto, paqueteId, userId]
        );

        if (result.affectedRows === 0) {
             const [[paquete]] = await db.query('SELECT 1 FROM paquetes WHERE id = ?', [paqueteId]);
             if (!paquete) return res.status(404).json({ message: "Paquete no encontrado." });
             else return res.status(403).json({ message: "Solo el creador puede cambiar el estado." });
        }

        io.to(paqueteId).emit('estado_paquete_cambiado', { paqueteId, abierto, changedBy: userId });
        res.status(200).json({ message: `Paquete ahora está ${abierto ? 'abierto' : 'cerrado'}.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al cambiar el estado del paquete." });
    }
});


// --- Socket.IO - Lógica de conexión y salas ---
io.on('connection', (socket) => {
    socket.on('unirse_a_paquete', async (paqueteId) => {
        try {
            const [[paquete]] = await db.query('SELECT 1 FROM paquetes WHERE id = ?', [paqueteId]);
            if (paquete) {
                socket.join(paqueteId);
            }
        } catch (error) {
            console.error("Error al verificar paquete para unirse a sala:", error);
        }
    });

    socket.on('salir_de_paquete', (paqueteId) => {
        socket.leave(paqueteId);
    });
});


// --- Rutas estáticas y de la App Principal ---
app.get('/privacidad', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy_es.html'));
});
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Inicio del Servidor ---
server.listen(PORT, async () => {
    await inicializarDb();
    console.log(`🚀 Servidor PartyFun escuchando en http://localhost:${PORT}`);
});
