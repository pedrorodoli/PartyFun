document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const viewContainer = document.getElementById('view-container');
    const appHeader = document.querySelector('.app-header'); // Get app-header
    const USER_UUID_KEY = 'partyFunUserUUID';
    const USER_NAME_KEY = 'partyFunUserName';

    let userUUID = localStorage.getItem(USER_UUID_KEY);
    let userName = localStorage.getItem(USER_NAME_KEY);

    if (!userUUID) {
        userUUID = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`; // More robust UUID
        localStorage.setItem(USER_UUID_KEY, userUUID);
        // If user name is important, consider a modal on first visit.
        if (!userName) {
            userName = 'Anónimo'; // Default name if not set
            localStorage.setItem(USER_NAME_KEY, userName);
        }
    }
    // For debugging
    console.log('User UUID:', userUUID);
    console.log('User Name:', userName);

    let currentPaqueteId = null;
    let timerIntervalId = null;
    let checkPalabrasIntervalId = null;

    let activeView = null;

    let gameStateClient = {};

    function resetGameState() {
        gameStateClient = {
            config: { numEquipos: 2, tiempoRonda: 45, maxPalabras: 50, maxRondas: 3, paquetes: [] },
            jugadoresOriginales: [],
            equipos: [],
            rondaActual: 1,
            turnoActual: { jugador: null, equipoIndex: 0, jugadorIndexEnEquipo: 0, ultimoJugadorIdEnEquipo: {} },
            palabrasOriginalesFull: [],
            palabrasParaLaPartida: [],
            palabrasDisponiblesRonda: [],
            palabrasAcertadasEnPartidaGlobal: [],
            palabrasIncorrectasTurnoActual: [],
            resultadosDelTurnoActual: [],
            puntosPorEquipoPorRonda: {},
            turnoFinalizado: false,
            partidaComenzada: false,
            palabraActualmenteEnJuego: null,
        };
    }
    resetGameState();


    async function renderView(templateId, data = {}) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template no encontrado: ${templateId}`);
            viewContainer.innerHTML = `<p class="text-danger text-center my-5">Error: Vista no encontrada (${templateId}).</p>`;
            return;
        }

        const newViewElement = document.createElement('div');
        newViewElement.innerHTML = template.innerHTML;
        const viewContent = newViewElement.firstElementChild;

        if (activeView && activeView.parentElement === viewContainer) {
            activeView.classList.remove('animate__fadeIn', 'animate__fadeInRight', 'animate__fadeInLeft', 'animate__fadeInUp', 'animate__jackInTheBox', 'animate__zoomInDown');
            activeView.classList.add('animate__fadeOut');
            await new Promise(resolve => setTimeout(resolve, 300));
            if (activeView.parentElement === viewContainer) {
                viewContainer.removeChild(activeView);
            }
        }
        
        viewContainer.appendChild(viewContent);
        activeView = viewContent;

        const viewName = templateId.replace('template-', '').replace(/-/g, '_');
        if (typeof window[`postRender_${viewName}`] === 'function') window[`postRender_${viewName}`](data);

        // --- INICIO: LÓGICA PARA OCULTAR ANUNCIOS ---
        // Vistas donde el anuncio DEBE estar oculto para cumplir políticas de AdSense.
        // Incluimos todas las vistas de "juego", "edición" y "configuración" para ser seguros.
        const viewsSinAnuncios = [
            'pre_turno', 
            'turno_juego', 
            'revision_turno', 
            'configurar_partida',
            'gestionar_paquete',
            'crear_paquete'
        ];
        const debeOcultarAnuncio = viewsSinAnuncios.includes(viewName);

        // Se añade una clase al body para controlar la visibilidad del banner con CSS.
        document.body.classList.toggle('anuncios-ocultos', debeOcultarAnuncio);

        // Se ajusta el padding inferior del contenedor principal para que no quede un espacio vacío.
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            // El valor '70px' debe coincidir con el padding que usas en CSS para dejar espacio al banner.
            appContainer.style.paddingBottom = debeOcultarAnuncio ? '0px' : '70px';
        }
        // --- FIN: LÓGICA PARA OCULTAR ANUNCIOS ---

        const isGameView = ['vista_equipos', 'pre_turno', 'turno_juego', 'revision_turno'].includes(viewName);
        const isFullWidthView = ['turno_juego', 'pre_turno'].includes(viewName);
        
        document.body.classList.toggle('game-view-bg', isGameView);
        
        if (templateId === 'template-inicio') {
            document.body.classList.add('home-view-active');
            if (appHeader) appHeader.classList.remove('solid-header');
            viewContainer.style.backgroundColor = 'var(--surface-color)';
            viewContainer.style.color = 'var(--on-surface-color)';
            viewContainer.style.boxShadow = 'var(--box-shadow-md)';
            viewContainer.style.maxWidth = '550px';
            viewContainer.style.padding = '30px';
            viewContainer.classList.remove('text-center');
        } else {
            document.body.classList.remove('home-view-active');
            if (appHeader) appHeader.classList.add('solid-header');
            
            if (isFullWidthView) {
                viewContainer.style.maxWidth = '100%';
                viewContainer.style.padding = '0';
                viewContainer.style.boxShadow = 'none';
                viewContainer.style.backgroundColor = 'transparent';
                viewContainer.style.color = 'var(--on-primary-color)';
            } else if (isGameView) {
                 viewContainer.style.maxWidth = '100%';
                 viewContainer.style.padding = '15px';
                 viewContainer.style.boxShadow = 'none';
                 viewContainer.style.backgroundColor = 'transparent';
                 viewContainer.style.color = 'var(--on-primary-color)';
            } else {
                viewContainer.style.maxWidth = '550px';
                viewContainer.style.padding = '20px';
                viewContainer.style.boxShadow = 'var(--box-shadow-md)';
                viewContainer.style.backgroundColor = 'var(--surface-color)';
                viewContainer.style.color = 'var(--on-surface-color)';
            }
            viewContainer.classList.remove('text-center');
        }
        window.scrollTo(0, 0);
    }

    // --- VISTAS --- (incluyendo las nuevas vistas informativas)
    window.postRender_inicio = () => { };

    window.postRender_acerca_de = () => {};
    window.postRender_terminos = () => {};
    window.postRender_privacidad = () => {};

    window.postRender_crear_paquete = () => {
        document.getElementById('formCrearPaquete').addEventListener('submit', async e => {
            e.preventDefault();
            const nombre = document.getElementById('nombrePaqueteNuevo').value.trim();
            if (!nombre) return showToast('Nombre vacío', 'warning', 3000, 'El nombre del paquete no puede estar vacío.');
            try {
                const res = await fetch('/api/paquetes', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, creadorId: userUUID })
                });
                const pkg = await res.json();
                if (!res.ok) throw new Error(pkg.message || 'Error creando paquete.');
                addMiPaqueteLocal({ id: pkg.id, nombre: pkg.nombre, numPalabras: 0, ownerId: pkg.ownerId, abierto: pkg.abierto });
                currentPaqueteId = pkg.id;
                renderView('template-gestionar-paquete', pkg);
                showToast('Paquete creado', 'success', 4000, `"${pkg.nombre}" listo. Comparte el código.`);
            } catch (err) {
                console.error(err);
                showToast('Error', 'danger', 4000, err.message);
            }
        });
    };

    window.postRender_gestionar_paquete = async pkgArg => {
        if (!pkgArg || !pkgArg.id) return renderView('template-inicio');
        currentPaqueteId = pkgArg.id;
        let pkg;

        try {
            const serverPkgRes = await fetch(`/api/paquetes/${pkgArg.id}`);
            if (!serverPkgRes.ok) throw new Error((await serverPkgRes.json()).message || 'Paquete no encontrado en servidor');
            pkg = await serverPkgRes.json();
        } catch (error) {
            showToast(`Error al cargar detalles del paquete: ${error.message}`, 'danger');
            return renderView('template-listar-mis-paquetes');
        }

        document.getElementById('tituloGestionPaquete').innerHTML = `Gestionar: <span class="text-primary fw-bold">${pkg.nombre}</span>`;
        document.getElementById('codigoPaqueteDisplay').textContent = pkg.id;
        document.getElementById('copyCodeButton').onclick = () => copyToClipboard(pkg.id);

        const shareButton = document.getElementById('shareLinkButton');
        if (shareButton) {
            shareButton.onclick = () => {
                const joinUrl = `${window.location.origin}/?join=${pkg.id}`;
                if (navigator.share) {
                    navigator.share({
                        title: `Únete a mi paquete de PartyFun: ${pkg.nombre}`,
                        text: `¡Añade palabras a mi paquete "${pkg.nombre}" en PartyFun!`,
                        url: joinUrl,
                    })
                    .then(() => console.log('Enlace compartido con éxito'))
                    .catch((error) => {
                        console.log('Fallback de compartir: Error en navigator.share, copiando al portapapeles.', error);
                        copyToClipboard(joinUrl);
                    });
                } else {
                    console.log('Fallback de compartir: navigator.share no disponible, copiando al portapapeles.');
                    copyToClipboard(joinUrl);
                }
            };
        }

        const switchEl = document.getElementById('switchPaqueteAbierto');
        const formAdd = document.getElementById('formAnadirPalabra');

        const isOwner = pkg.ownerId === userUUID;

        const btnAccionPaquete = document.getElementById('btnEliminarPaqueteDesdeGestion');
        if (btnAccionPaquete) {
            if (isOwner) {
                btnAccionPaquete.style.display = 'block';
                btnAccionPaquete.textContent = 'Eliminar Paquete';
                btnAccionPaquete.className = 'btn btn-danger mt-2';
                btnAccionPaquete.onclick = () => confirmarYEliminarPaquete(pkg.id, pkg.nombre);
            } else {
                btnAccionPaquete.style.display = 'block';
                btnAccionPaquete.textContent = 'Salir de Paquete';
                btnAccionPaquete.className = 'btn btn-warning mt-2';
                btnAccionPaquete.onclick = () => {
                    if (confirm(`¿Seguro que quieres salir del paquete "${pkg.nombre}"? Dejará de aparecer en tu lista.`)) {
                        removerPaqueteLocalmente(pkg.id);
                        showToast(`Has salido del paquete "${pkg.nombre}".`, 'info');
                        renderView('template-listar-mis-paquetes');
                    }
                };
            }
        }

        switchEl.disabled = !isOwner;
        switchEl.checked = pkg.abierto;
        formAdd.style.display = pkg.abierto || isOwner ? 'flex' : 'none';

        if (!pkg.abierto && !isOwner) {
            showToast('Paquete cerrado', 'info', 4000, 'Solo el creador puede añadir nuevas palabras.');
        } else if (!pkg.abierto && isOwner) {
            showToast('Paquete cerrado', 'info', 4000, 'Cerrado para otros, pero tú puedes añadir palabras.');
        }

        cargarPalabrasDelPaquete(pkg.id, true);
        socket.emit('unirse_a_paquete', pkg.id);

        switchEl.onchange = async () => {
            if (!isOwner) return;
            const nuevoEstado = switchEl.checked;
            formAdd.style.display = nuevoEstado || isOwner ? 'flex' : 'none';

            try {
                const res = await fetch(`/api/paquetes/${pkg.id}/estado`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ abierto: nuevoEstado, userId: userUUID })
                });
                const dataDelFetch = await res.json();
                if (!res.ok) throw new Error(dataDelFetch.message);

                pkg.abierto = nuevoEstado;

            } catch (e) {
                showToast(`Error al cambiar estado: ${e.message}`, 'danger');
                switchEl.checked = !nuevoEstado;
                formAdd.style.display = !nuevoEstado || isOwner ? 'flex' : 'none';
            }
        };

        formAdd.onsubmit = async e => {
            e.preventDefault();
            const input = document.getElementById('palabraNueva');
            const palabra = input.value.trim();
            if (!palabra) return showToast('Escribe una palabra.', 'warning');
            if (!pkg.abierto && !isOwner) {
                showToast('No puedes añadir palabras. El paquete está cerrado y no eres el creador.', 'warning');
                return;
            }
            try {
                const res = await fetch(`/api/paquetes/${pkg.id}/palabras`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ palabra, userId: userUUID })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message);
                input.value = '';
            } catch (e) {
                showToast(`Error: ${e.message}`, 'danger');
            }
        };
    };

    window.postRender_unirse_paquete = () => {
        document.getElementById('formUnirsePaquete').onsubmit = async e => {
            e.preventDefault();
            const code = document.getElementById('codigoPaqueteUnir').value.trim();
            if (!code) return showToast('Introduce un código.', 'warning');
            try {
                const res = await fetch(`/api/paquetes/${code}`);
                if (!res.ok) throw new Error((await res.json()).message || 'Código no válido o paquete no encontrado.');
                const pkg = await res.json();
                addMiPaqueteLocal({ id: pkg.id, nombre: pkg.nombre, numPalabras: pkg.palabras.length, ownerId: pkg.ownerId, abierto: pkg.abierto });
                currentPaqueteId = pkg.id;
                renderView('template-gestionar-paquete', pkg);
            } catch (e) {
                showToast(`Error: ${e.message}`, 'danger');
            }
        };
    };


    window.postRender_listar_mis_paquetes = async () => {
        const listElement = document.getElementById('listaMisPaquetes');
        listElement.innerHTML = '<p class="list-group-item text-center text-muted">Actualizando lista de paquetes...</p>';

        let paquetesParaMostrarEnUI = [];

        try {
            const serverPaquetesRes = await fetch('/api/paquetes');
            if (!serverPaquetesRes.ok) {
                listElement.innerHTML = `<p class="list-group-item text-center text-danger">No se pudo cargar la lista de paquetes del servidor.</p>`;
                console.error('Error fetching server packages:', await serverPaquetesRes.text());
                return;
            }
            const todosLosPaquetesDelServidor = await serverPaquetesRes.json();

            const misPaquetesLocalesOriginales = getMisPaquetesLocales();
            const misPaquetesLocalesIds = new Set(misPaquetesLocalesOriginales.map(p => p.id));

            paquetesParaMostrarEnUI = todosLosPaquetesDelServidor.filter(sp => 
                misPaquetesLocalesIds.has(sp.id) ||
                sp.ownerId === userUUID // Ensure owner also sees their packages
            );

            const paquetesSincronizadosParaLocalStorage = paquetesParaMostrarEnUI.map(sp => {
                return {
                    id: sp.id,
                    nombre: sp.nombre,
                    numPalabras: sp.numPalabras,
                    ownerId: sp.ownerId,
                    abierto: sp.abierto,
                };
            });
            saveMisPaquetesLocales(paquetesSincronizadosParaLocalStorage);

            listElement.innerHTML = '';
            if (!paquetesParaMostrarEnUI.length) {
                listElement.innerHTML = '<p class="list-group-item text-center text-muted">No tienes paquetes activos. ¡Crea uno o únete a alguno!</p>';
                return;
            }

            paquetesParaMostrarEnUI.forEach(p => {
                const div = document.createElement('div');
                div.className = 'list-group-item d-flex justify-content-between align-items-center flex-wrap';

                const esOwnerEstePaquete = p.ownerId === userUUID;
                
                let roleBadge = '';
                if (esOwnerEstePaquete) {
                    roleBadge = '<span class="badge bg-primary rounded-pill ms-2">Creador</span>';
                } else {
                    roleBadge = '<span class="badge bg-secondary rounded-pill ms-2">Añadido</span>';
                }

                let botonesHtml = `<button class="btn btn-sm btn-outline-primary mb-1 mb-md-0" style="width: 100px; height: 28px;" data-pkg-id="${p.id}" data-action-pkg="gestionar">Gestionar</button>`;
                if (esOwnerEstePaquete) {
                    botonesHtml += `<button class="btn btn-sm btn-outline-danger ms-md-2" style="width: 100px; height: 28px;" data-pkg-id="${p.id}" data-pkg-nombre="${p.nombre}" data-action-pkg="eliminar">
                                        <i class="bi bi-trash-fill icon-sm me-1"></i>
                                        Eliminar
                                    </button>`;
                } else {
                    botonesHtml += `<button class="btn btn-sm btn-outline-warning ms-md-2" style="width: 100px; height: 28px;" data-pkg-id="${p.id}" data-pkg-nombre="${p.nombre}" data-action-pkg="salir">
                                        <i class="bi bi-box-arrow-left icon-sm me-1"></i>
                                        Salir
                                    </button>`;
                }

                div.innerHTML = `
                    <div class="me-auto">
                        <strong>${p.nombre}</strong>${roleBadge}
                        <small class="d-block text-muted">Palabras: ${p.numPalabras} - Estado: ${p.abierto ? 'Abierto' : 'Cerrado'}</small>
                    </div>
                    <div class="btn-group paquete-actions ms-2 mt-2 mt-md-0" role="group">
                        ${botonesHtml}
                    </div>`;

                div.querySelectorAll('[data-action-pkg]').forEach(button => {
                    button.onclick = (e) => {
                        const action = e.currentTarget.dataset.actionPkg;
                        const paqueteId = e.currentTarget.dataset.pkgId;
                        const paqueteSeleccionado = paquetesParaMostrarEnUI.find(pkg => pkg.id === paqueteId);

                        if (!paqueteSeleccionado) {
                            showToast("El paquete ya no está disponible o hubo un error.", "warning");
                            renderView('template-listar-mis-paquetes');
                            return;
                        }

                        if (action === 'gestionar') {
                            renderView('template-gestionar-paquete', paqueteSeleccionado);
                        } else if (action === 'eliminar') {
                            confirmarYEliminarPaquete(paqueteSeleccionado.id, paqueteSeleccionado.nombre);
                        } else if (action === 'salir') {
                            if (confirm(`¿Seguro que quieres salir del paquete "${paqueteSeleccionado.nombre}"? Dejará de aparecer en tu lista.`)) {
                                removerPaqueteLocalmente(paqueteId);
                                showToast(`Has salido del paquete "${paqueteSeleccionado.nombre}".`, 'info');
                                renderView('template-listar-mis-paquetes');
                            }
                        }
                    };
                });
                listElement.appendChild(div);
            });

        } catch (error) {
            listElement.innerHTML = `<p class="list-group-item text-center text-danger">Error al cargar tus paquetes: ${error.message}</p>`;
            console.error("Error en postRender_listar_mis_paquetes:", error);
        }
    };

    function removerPaqueteLocalmente(paqueteId) {
        let paquetes = getMisPaquetesLocales();
        const paqueteOriginal = paquetes.find(p => p.id === paqueteId);
        paquetes = paquetes.filter(p => p.id !== paqueteId);
        saveMisPaquetesLocales(paquetes);
        console.log(`Paquete ${paqueteId} removido localmente.`);
        return paqueteOriginal;
    }

    async function confirmarYEliminarPaquete(paqueteId, paqueteNombre) {
        if (!confirm(`¿Estás seguro de que quieres eliminar el paquete "${paqueteNombre}"? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const res = await fetch(`/api/paquetes/${paqueteId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userUUID })
            });

            let data;
            try {
                data = await res.json();
            } catch (e) {
                data = { message: await res.text() || `Error ${res.status} del servidor.` };
            }

            if (!res.ok) {
                throw new Error(data.message || `Error al eliminar el paquete (estado ${res.status}).`);
            }

            showToast(data.message || `Paquete "${paqueteNombre}" eliminado.`, 'success');

            removerPaqueteLocalmente(paqueteId);

            const gestionViewActive = activeView && activeView.querySelector('#tituloGestionPaquete');
            const listaViewActive = activeView && activeView.querySelector('#listaMisPaquetes');

            if (currentPaqueteId === paqueteId && gestionViewActive) {
                currentPaqueteId = null;
                renderView('template-listar-mis-paquetes');
            } else if (listaViewActive) {
                renderView('template-listar-mis-paquetes');
            }

        } catch (err) {
            console.error('Error eliminando paquete:', err);
            showToast(`Error: ${err.message}`, 'danger');
        }
    }

    window.postRender_configurar_partida = () => {
        const form = document.getElementById('formConfigurarPartida');
        const inp = document.getElementById('inputNombreJugador');
        const btnAdd = document.getElementById('btnAnadirJugadorConfig');
        const listJ = document.getElementById('listaJugadoresConfig');
        const contP = document.getElementById('listaPaquetesSeleccion');
        const totalUI = document.getElementById('totalPalabrasDisponiblesConfig');
        const numEquiposInput = document.getElementById('numEquipos'); 

        listJ.innerHTML = '';
        if (gameStateClient.jugadoresOriginales && gameStateClient.jugadoresOriginales.length > 0 && !gameStateClient.partidaComenzada) {
            gameStateClient.jugadoresOriginales.forEach(jugador => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.innerHTML = `${jugador.nombre}<button class="btn btn-sm btn-outline-danger py-0 px-1" data-id="${jugador.id}">X</button>`;
                li.querySelector('button').onclick = (e) => {
                    const idToRemove = e.target.dataset.id;
                    listJ.removeChild(li);
                    gameStateClient.jugadoresOriginales = gameStateClient.jugadoresOriginales.filter(j => j.id !== idToRemove);
                };
                listJ.appendChild(li);
            });
        } else {
            gameStateClient.jugadoresOriginales = [];
        }

        contP.innerHTML = '<div class="text-center text-muted p-2">Cargando paquetes...</div>';
        totalUI.textContent = '0';

    (async () => {
        let paquetesParaSeleccion = [];
        try {
            const serverPaquetesRes = await fetch('/api/paquetes');
            if (!serverPaquetesRes.ok) throw new Error('No se pudo cargar la lista de paquetes del servidor.');
            const todosLosPaquetesDelServidor = await serverPaquetesRes.json();

            const misPaquetesLocalesOriginales = getMisPaquetesLocales();
            const misPaquetesLocalesIds = new Set(misPaquetesLocalesOriginales.map(p => p.id));

            paquetesParaSeleccion = todosLosPaquetesDelServidor.filter(sp => misPaquetesLocalesIds.has(sp.id));
            
            const paquetesSincronizadosParaLocalStorage = paquetesParaSeleccion.map(sp => ({
                id: sp.id,
                nombre: sp.nombre,
                numPalabras: sp.numPalabras,
                ownerId: sp.ownerId,
                abierto: sp.abierto,
            }));
            saveMisPaquetesLocales(paquetesSincronizadosParaLocalStorage);

        } catch (error) {
            console.error("Error cargando paquetes para configuración:", error);
            contP.innerHTML = `<div class="alert alert-warning text-center small p-2">Error al cargar paquetes: ${error.message}</div>`;
        }

        contP.innerHTML = '';

        if (!paquetesParaSeleccion.length) {
             contP.innerHTML = '<div class="text-center text-muted p-2">No tienes paquetes con palabras. Crea o únete a uno.</div>';
        } else {
            paquetesParaSeleccion.filter(p => p.numPalabras > 0).forEach(p => {
                const d = document.createElement('div');
                d.className = 'form-check';
                const isChecked = !gameStateClient.partidaComenzada && gameStateClient.config && gameStateClient.config.paquetes.includes(p.id) ? 'checked' : '';
                d.innerHTML = `<input class="form-check-input paquete-checkbox" type="checkbox" value="${p.id}" data-num="${p.numPalabras}" id="chk-cfg-${p.id}" ${isChecked}><label class="form-check-label" for="chk-cfg-${p.id}">${p.nombre} (${p.numPalabras})</label>`;
                contP.appendChild(d);
            });
        }

        let initialTotal = 0;
        contP.querySelectorAll('.paquete-checkbox:checked').forEach(c => initialTotal += +c.dataset.num);
        totalUI.textContent = initialTotal;

        contP.querySelectorAll('.paquete-checkbox').forEach(chk => chk.onchange = () => {
            let tot = 0;
            contP.querySelectorAll('.paquete-checkbox:checked').forEach(c => tot += +c.dataset.num);
            totalUI.textContent = tot;
        });

    })();

        btnAdd.onclick = () => {
            const name = inp.value.trim(); if (!name) return showToast('¿Nombre del jugador?', 'warning');
            if (gameStateClient.jugadoresOriginales.some(j => j.nombre.toLowerCase() === name.toLowerCase())) {
                return showToast('Ese nombre de jugador ya existe.', 'warning');
            }
            const id = `jug-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            gameStateClient.jugadoresOriginales.push({ id, nombre: name, turnosPartida: 0 });
            const li = document.createElement('li'); li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `${name}<button class="btn btn-sm btn-outline-danger py-0 px-1" data-id="${id}">X</button>`;
            li.querySelector('button').onclick = (e) => {
                const idToRemove = e.target.dataset.id;
                listJ.removeChild(li);
                gameStateClient.jugadoresOriginales = gameStateClient.jugadoresOriginales.filter(j => j.id !== idToRemove);
            };
            listJ.appendChild(li); inp.value = ''; inp.focus();
        };

        form.onsubmit = async e => {
            e.preventDefault();
            resetGameState();

            gameStateClient.jugadoresOriginales = [];
            const jugadoresLi = listJ.querySelectorAll('li');
            jugadoresLi.forEach(li => {
                const nombre = li.textContent.replace(/X$/, '').trim();
                const id = li.querySelector('button') ? li.querySelector('button').dataset.id : `jug-manual-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                gameStateClient.jugadoresOriginales.push({ id, nombre, turnosPartida: 0 });
            });

            const numEquipos = +numEquiposInput.value;
            const jugadoresMinimosNecesarios = numEquipos * 2;
            if (gameStateClient.jugadoresOriginales.length < jugadoresMinimosNecesarios) {
                return showToast('Faltan jugadores', 'warning', 4000, `Necesitas al menos ${jugadoresMinimosNecesarios} para ${numEquipos} equipos.`);
            }

            const tiempoRonda = +document.getElementById('tiempoRonda').value;
            const maxPal = +document.getElementById('maxPalabras').value;
            const sel = Array.from(contP.querySelectorAll('.paquete-checkbox:checked')).map(c => c.value);
            if (!sel.length) return showToast('Sin paquetes', 'warning', 3000, 'Selecciona al menos un paquete.');

            let totalPalabrasSeleccionadas = 0;
            contP.querySelectorAll('.paquete-checkbox:checked').forEach(c => totalPalabrasSeleccionadas += +c.dataset.num);
            if (totalPalabrasSeleccionadas === 0) return showToast('Paquetes vacíos', 'warning', 3000, 'Los paquetes seleccionados no tienen palabras.');
            if (maxPal > totalPalabrasSeleccionadas && totalPalabrasSeleccionadas > 0) {
                showToast('Ajuste de palabras', 'info', 4000, `Se usarán las ${totalPalabrasSeleccionadas} disponibles.`);
            }

            gameStateClient.config = { numEquipos, tiempoRonda, maxPalabras: maxPal, paquetes: sel, maxRondas: 3 };

            try {
                await prepararPartida();
                renderView('template-vista-equipos');
            } catch (err) {
                showToast(`Error preparando partida: ${err.message}`, 'danger');
                console.error(err);
            }
        };
    };

    async function prepararPartida() {
        showToast('Preparando partida...', 'info', 2000);
        gameStateClient.equipos = [];
        gameStateClient.rondaActual = 1;
        gameStateClient.turnoActual = { jugador: null, equipoIndex: 0, jugadorIndexEnEquipo: 0, ultimoJugadorIdEnEquipo: {} };
        gameStateClient.palabrasOriginalesFull = [];
        gameStateClient.palabrasParaLaPartida = [];
        gameStateClient.palabrasDisponiblesRonda = [];
        gameStateClient.palabrasAcertadasEnPartidaGlobal = [];
        gameStateClient.palabrasIncorrectasTurnoActual = [];
        gameStateClient.resultadosDelTurnoActual = [];
        gameStateClient.puntosPorEquipoPorRonda = {};
        gameStateClient.jugadoresOriginales.forEach(j => j.turnosPartida = 0);


        for (const id of gameStateClient.config.paquetes) {
            try {
                const res = await fetch(`/api/paquetes/${id}`);
                if (res.ok) {
                    const p = await res.json();
                    gameStateClient.palabrasOriginalesFull.push(...p.palabras);
                }
            } catch (err) { console.error(`Error cargando palabras del paquete ${id}:`, err); }
        }

        const palabrasUnicasPorTexto = [];
        const textosVistos = new Set();
        for (const palabraObj of gameStateClient.palabrasOriginalesFull) {
            if (!textosVistos.has(palabraObj.texto.toLowerCase())) {
                palabrasUnicasPorTexto.push(palabraObj);
                textosVistos.add(palabraObj.texto.toLowerCase());
            }
        }

        const palabrasBarajadas = palabrasUnicasPorTexto.sort(() => 0.5 - Math.random());
        gameStateClient.palabrasParaLaPartida = palabrasBarajadas.slice(0, gameStateClient.config.maxPalabras);

        if (!gameStateClient.palabrasParaLaPartida.length) {
            throw new Error('No hay palabras disponibles para la partida con los paquetes y filtros seleccionados.');
        }

        gameStateClient.palabrasDisponiblesRonda = [...gameStateClient.palabrasParaLaPartida].sort(() => 0.5 - Math.random());

        const shuffledJugadores = [...gameStateClient.jugadoresOriginales].sort(() => 0.5 - Math.random());
        gameStateClient.equipos = Array.from({ length: gameStateClient.config.numEquipos }, () => []);
        shuffledJugadores.forEach((j, i) => gameStateClient.equipos[i % gameStateClient.config.numEquipos].push(j));
    }


    window.postRender_vista_equipos = () => {
        document.getElementById('rondaActualDisplay').textContent = gameStateClient.rondaActual;
        document.getElementById('rondaMaximaDisplay').textContent = gameStateClient.config.maxRondas;
        const contEquiposDisplay = document.getElementById('contenedorEquiposDisplay');
        contEquiposDisplay.innerHTML = '';
        contEquiposDisplay.className = `row row-cols-1 row-cols-sm-2 row-cols-md-${Math.min(gameStateClient.equipos.length, 4)} g-3 mb-4`;

        const puedeEditarEquipos = !gameStateClient.partidaComenzada;
        const controlesEdicion = document.getElementById('controlesEdicionEquipos');
        if (controlesEdicion) {
            controlesEdicion.style.display = puedeEditarEquipos ? 'block' : 'none';
        }

        gameStateClient.equipos.forEach((eq, i) => {
            let puntosTotalesEquipo = 0;
            for (let r = 1; r <= gameStateClient.rondaActual; r++) {
                puntosTotalesEquipo += (gameStateClient.puntosPorEquipoPorRonda[r] && gameStateClient.puntosPorEquipoPorRonda[r][i]) || 0;
            }

            const divCol = document.createElement('div'); divCol.className = 'col d-flex';
            const divCard = document.createElement('div');
            divCard.className = 'card h-100 shadow-sm animate__animated animate__fadeInUp flex-fill team-card';
            divCard.innerHTML = `
                <div class="card-header text-white text-center" style="background-color:${getTeamColorForDisplay(i)}">
                    <h5 class="mb-0">Equipo ${i + 1} <small class="fw-normal opacity-75">- Pts: ${puntosTotalesEquipo}</small></h5>
                </div>
                <ul class="list-group list-group-flush team-player-list p-2" data-equipo-index="${i}">
                    ${eq.length ? eq.map(j => `
                        <li class="list-group-item player-item d-flex justify-content-between align-items-center" 
                            data-jugador-id="${j.id}" 
                            draggable="${puedeEditarEquipos}">
                            <span>${j.nombre}</span>
                            <span class="badge bg-light text-dark rounded-pill">Turnos: ${j.turnosPartida}</span>
                        </li>`).join('')
                : '<li class="list-group-item text-muted fst-italic p-3">Arrastra jugadores aquí</li>'}
                </ul>`;

            divCol.appendChild(divCard);
            contEquiposDisplay.appendChild(divCol);

            if (puedeEditarEquipos) {
                const ulEquipo = divCard.querySelector('.team-player-list');
                ulEquipo.addEventListener('dragover', handleDragOver);
                ulEquipo.addEventListener('drop', handleDrop);
                ulEquipo.addEventListener('dragleave', handleDragLeave);

                ulEquipo.querySelectorAll('.player-item').forEach(item => {
                    item.addEventListener('dragstart', handleDragStart);
                    item.addEventListener('dragend', handleDragEnd);
                });
            }
        });

        const btnIniciar = document.getElementById('btnIniciarTurnoJuego');

        const finDePartida = gameStateClient.partidaComenzada &&
            gameStateClient.rondaActual >= gameStateClient.config.maxRondas &&
            gameStateClient.palabrasDisponiblesRonda.length === 0;

        if (finDePartida) {
            btnIniciar.textContent = 'Ver Resultados Finales';
            btnIniciar.className = 'btn btn-info btn-lg';
            btnIniciar.onclick = () => renderView('template-resultados-finales');
        } else {
            if (!gameStateClient.partidaComenzada) {
                btnIniciar.textContent = 'Empezar Partida';
            } else {
                if (gameStateClient.palabrasDisponiblesRonda.length > 0) {
                    btnIniciar.textContent = 'Siguiente Turno';
                } else {
                    btnIniciar.textContent = 'Iniciar Siguiente Ronda';
                }
            }
            btnIniciar.className = 'btn btn-success btn-lg';
            btnIniciar.onclick = iniciarSiguienteTurnoLogica;
        }

        document.getElementById('btnTerminarPartidaVolverConfig').onclick = () => {
            if (confirm('¿Seguro que quieres terminar la partida y volver a la configuración? El progreso se perderá.')) {
                resetGameState();
                renderView('template-configurar-partida');
            }
        };

        const btnReorganizar = document.getElementById('btnReorganizarEquiposJuego');
        if (btnReorganizar && puedeEditarEquipos) {
            btnReorganizar.onclick = () => {
                reorganizarEquiposAleatoriamente();
                renderView('template-vista-equipos');
            };
        } else if (btnReorganizar) {
            btnReorganizar.onclick = null;
        }
    };

    function reorganizarEquiposAleatoriamente() {
        if (!gameStateClient.jugadoresOriginales || gameStateClient.jugadoresOriginales.length === 0) {
            showToast('No hay jugadores para reorganizar.', 'warning');
            return;
        }

        const shuffledJugadores = [...gameStateClient.jugadoresOriginales].sort(() => 0.5 - Math.random());

        gameStateClient.equipos = Array.from({ length: gameStateClient.config.numEquipos }, () => []);

        shuffledJugadores.forEach((j, i) => {
            const jugadorOriginal = gameStateClient.jugadoresOriginales.find(jo => jo.id === j.id);
            if (jugadorOriginal) jugadorOriginal.turnosPartida = 0;

            gameStateClient.equipos[i % gameStateClient.config.numEquipos].push(j);
        });

        gameStateClient.turnoActual = { jugador: null, equipoIndex: 0, jugadorIndexEnEquipo: 0, ultimoJugadorIdEnEquipo: {} };
        if (gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual]) {
            gameStateClient.equipos.forEach((_, i) => {
                if (gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual]) {
                    gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual][i] = 0;
                }
            });
        }
        showToast('Equipos reorganizados aleatoriamente.', 'info');
    }

    let draggedPlayerId = null;
    let sourceTeamIndex = null;

    function handleDragStart(e) {
        draggedPlayerId = e.target.dataset.jugadorId;
        const sourceList = e.target.closest('.team-player-list');
        sourceTeamIndex = sourceList ? sourceList.dataset.equipoIndex : null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedPlayerId);
        setTimeout(() => e.target.classList.add('dragging'), 0);
    }

    function handleDragEnd(e) {
        e.target.classList.remove('dragging');
        draggedPlayerId = null;
        sourceTeamIndex = null;
        document.querySelectorAll('.drop-zone-active').forEach(el => el.classList.remove('drop-zone-active'));
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drop-zone-active');
    }

    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drop-zone-active');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drop-zone-active');
        if (!draggedPlayerId || sourceTeamIndex === null) return;

        const targetTeamIndex = e.currentTarget.dataset.equipoIndex;

        if (sourceTeamIndex !== targetTeamIndex) {
            const sourceEquipo = gameStateClient.equipos[sourceTeamIndex];
            const targetEquipo = gameStateClient.equipos[targetTeamIndex];

            const jugadorIndex = sourceEquipo.findIndex(j => j.id === draggedPlayerId);
            if (jugadorIndex > -1) {
                const [jugadorMovido] = sourceEquipo.splice(jugadorIndex, 1);
                targetEquipo.push(jugadorMovido);

                renderView('template-vista-equipos');
                showToast(`${jugadorMovido.nombre} movido al Equipo ${parseInt(targetTeamIndex) + 1}.`, 'info');
            }
        }
        draggedPlayerId = null;
        sourceTeamIndex = null;
    }

    function iniciarSiguienteTurnoLogica() {
        if (!gameStateClient.partidaComenzada) {
            for (let i = 0; i < gameStateClient.equipos.length; i++) {
                if (gameStateClient.equipos[i].length < 2) {
                    showToast(`El Equipo ${i + 1} no tiene suficientes jugadores (mínimo 2). Reorganiza los equipos.`, 'warning');
                    return;
                }
            }
            gameStateClient.partidaComenzada = true;
            gameStateClient.turnoActual.ultimoJugadorIdEnEquipo = {};
        }

        gameStateClient.turnoFinalizado = false;

        if (gameStateClient.palabrasDisponiblesRonda.length === 0) {
            if (gameStateClient.rondaActual >= gameStateClient.config.maxRondas) {
                showToast('¡Se han completado todas las rondas y palabras! Partida finalizada.', 'success', 3000);
                renderView('template-resultados-finales');
                return;
            } else {
                gameStateClient.rondaActual++;
                gameStateClient.palabrasDisponiblesRonda = [...gameStateClient.palabrasParaLaPartida].sort(() => 0.5 - Math.random());
                showToast(`Iniciando Ronda ${gameStateClient.rondaActual}! Todas las palabras vuelven a estar disponibles.`, 'info', 3500);
                renderView('template-vista-equipos');
                return;
            }
        }

        const equipoActualIndex = gameStateClient.turnoActual.jugador === null ? 0 : (gameStateClient.turnoActual.equipoIndex + 1) % gameStateClient.equipos.length;
        const equipoActual = gameStateClient.equipos[equipoActualIndex];

        if (!equipoActual || equipoActual.length < 2) { 
            showToast(`El equipo ${equipoActualIndex + 1} no tiene suficientes jugadores (mínimo 2). Reconfigura la partida.`, 'danger');
            resetGameState();
            return renderView('template-configurar-partida');
        }

        let proximoJugador = null;
        let proximoJugadorIndexEnEquipo = -1;

        const minTurnosJugadosEnEquipo = Math.min(...equipoActual.map(j => j.turnosPartida || 0));
        const candidatos = equipoActual.filter(j => (j.turnosPartida || 0) === minTurnosJugadosEnEquipo);

        if (candidatos.length === 1) {
            proximoJugador = candidatos[0];
            proximoJugadorIndexEnEquipo = equipoActual.findIndex(j => j.id === proximoJugador.id);
        } else if (candidatos.length > 1) {
            const ultimoJugadorIdEsteEquipo = gameStateClient.turnoActual.ultimoJugadorIdEnEquipo[equipoActualIndex];
            let startIndex = 0;
            if (ultimoJugadorIdEsteEquipo) {
                const ultimoCandidatoIndex = candidatos.findIndex(j => j.id === ultimoJugadorIdEsteEquipo);
                if (ultimoCandidatoIndex !== -1) {
                    startIndex = (ultimoCandidatoIndex + 1) % candidatos.length;
                }
            }
            proximoJugador = candidatos[startIndex];
            proximoJugadorIndexEnEquipo = equipoActual.findIndex(j => j.id === proximoJugador.id);
        }
        
        if (!proximoJugador) {
            console.warn("Fallback: No se pudo determinar el próximo jugador por turnos, seleccionando el primero del equipo.");
            proximoJugador = equipoActual[0];
            proximoJugadorIndexEnEquipo = 0;
        }

        gameStateClient.turnoActual = {
            ...gameStateClient.turnoActual,
            jugador: proximoJugador,
            equipoIndex: equipoActualIndex,
            jugadorIndexEnEquipo: proximoJugadorIndexEnEquipo,
        };
        gameStateClient.turnoActual.ultimoJugadorIdEnEquipo[equipoActualIndex] = proximoJugador.id;

        proximoJugador.turnosPartida = (proximoJugador.turnosPartida || 0) + 1;

        gameStateClient.resultadosDelTurnoActual = [];
        gameStateClient.palabrasIncorrectasTurnoActual = [];
        renderView('template-pre-turno');
    }

    window.postRender_pre_turno = () => {
        const j = gameStateClient.turnoActual.jugador;
        if (!j) {
            showToast('Error: No se pudo determinar el jugador del turno.', 'danger');
            return renderView('template-vista-equipos');
        }
        document.getElementById('preTurnoRonda').textContent = gameStateClient.rondaActual;
        document.getElementById('preTurnoNombreJugador').textContent = j.nombre;
        document.getElementById('preTurnoEquipoNombre').textContent = `Equipo ${gameStateClient.turnoActual.equipoIndex + 1}`;
        document.getElementById('preTurnoPalabrasDisponibles').textContent = gameStateClient.palabrasDisponiblesRonda.length;
        document.getElementById('btnEmpezarTurnoGameplay').onclick = () => renderView('template-turno-juego');
    };

    window.postRender_turno_juego = () => {
        const j = gameStateClient.turnoActual.jugador;
        document.getElementById('turnoNombreJugadorDisplay').textContent = `Turno de: ${j.nombre}`;
        document.getElementById('turnoInfoEquipoRondaDisplay').textContent = `Equipo ${gameStateClient.turnoActual.equipoIndex + 1} - Ronda ${gameStateClient.rondaActual}`;

        const elem = document.getElementById('turnoCountdown');
        let countDown = 3;
        elem.classList.add('animate__bounceIn');
        elem.textContent = countDown;
        const preInt = setInterval(() => {
            countDown--;
            if (countDown > 0) {
                elem.textContent = countDown;
            } else if (countDown === 0) {
                elem.textContent = '¡YA!';
            } else {
                clearInterval(preInt);
                elem.classList.remove('animate__bounceIn');
                empezarCronometroTurno();
            }
        }, 800);
    };

    function empezarCronometroTurno() {
        gameStateClient.turnoFinalizado = false;
        const total = gameStateClient.config.tiempoRonda;
        let rem = total;
        const elem = document.getElementById('turnoCountdown');
        elem.textContent = rem;

        mostrarSiguientePalabraJuego();

        timerIntervalId = setInterval(() => {
            if (gameStateClient.turnoFinalizado) return;
            rem--;
            elem.textContent = rem;
            if (rem <= 0) {
                finalizarCronometroYTurno('tiempo');
            }
        }, 1000);

        checkPalabrasIntervalId = setInterval(() => {
            if (gameStateClient.turnoFinalizado) return;
            if (!gameStateClient.palabrasDisponiblesRonda.length &&
                !document.getElementById('turnoPalabraWrapper').querySelector('.palabra-en-juego') && // Check if word card actually empty
                rem > 0) {
                // This case should be handled by mostrarSiguientePalabraJuego leading to finalizar...
                // Log it if it happens, could be an edge case
                // console.warn("Check interval: No more words available and turn not auto-ended.");
            }
        }, 200); // Check frequently
    }

    function finalizarCronometroYTurno(reason = "desconocido") {
        if (gameStateClient.turnoFinalizado) return;
        gameStateClient.turnoFinalizado = true;

        console.log("Finalizando turno, razón:", reason);
        clearInterval(timerIntervalId);
        clearInterval(checkPalabrasIntervalId);

        const palabraQueEstabaEnJuego = gameStateClient.palabraActualmenteEnJuego;
        if (palabraQueEstabaEnJuego) {
            if (reason === 'tiempo') {
                console.log(`Tiempo agotado. Palabra "${palabraQueEstabaEnJuego.texto}" vuelve al mazo de la ronda.`);
                gameStateClient.palabrasIncorrectasTurnoActual.push(palabraQueEstabaEnJuego);
            }
            gameStateClient.palabraActualmenteEnJuego = null;
        }
        
        const wrapper = document.getElementById('turnoPalabraWrapper');
        if (wrapper) {
            let mensajeFinal = "¡TIEMPO!";
            if (reason === "sin_palabras_disponibles") mensajeFinal = "¡SIN PALABRAS!";
            wrapper.innerHTML = `<div class="palabra-display-card"><span class="palabra-en-juego text-warning">${mensajeFinal}</span></div>`;
        }

        showToast(reason === "tiempo" ? '¡Tiempo!' : '¡Sin palabras!', 'info', 2000, reason === "tiempo" ? 'El tiempo se ha agotado.' : 'No quedan palabras en este turno.');

        setTimeout(() => {
            renderView('template-revision-turno');
        }, 1500);
    }

     function mostrarSiguientePalabraJuego() {
        if (gameStateClient.turnoFinalizado) {
            if (gameStateClient.palabraActualmenteEnJuego) {
                 gameStateClient.palabraActualmenteEnJuego = null;
            }
            return;
        }

        const wrapper = document.getElementById('turnoPalabraWrapper');
        const info = document.getElementById('turnoInfoPalabrasRestantes');

        if (!wrapper || !info) {
            console.warn("Intentando mostrar palabra pero los elementos no existen. Vista podría haber cambiado.");
            return;
        }

        if (gameStateClient.palabrasDisponiblesRonda.length === 0) {
            info.textContent = "Quedan: 0 palabras";
            wrapper.innerHTML = `<div class="palabra-display-card animate__animated animate__fadeIn"><span class="palabra-en-juego text-success">¡NO QUEDAN MÁS PALABRAS EN ESTA RONDA!</span></div>`;
            gameStateClient.palabraActualmenteEnJuego = null; 
            if (!gameStateClient.turnoFinalizado) { 
                finalizarCronometroYTurno('sin_palabras_disponibles');
            }
            return;
        }

        info.textContent = `Quedan: ${gameStateClient.palabrasDisponiblesRonda.length} palabras`;
        const palabraObj = gameStateClient.palabrasDisponiblesRonda.shift();
        gameStateClient.palabraActualmenteEnJuego = palabraObj; 

        wrapper.innerHTML = `
            <div class="palabra-display-card animate__animated animate__fadeInDown">
                <span class="palabra-en-juego">${palabraObj.texto.toUpperCase()}</span>
            </div>
            <div class="botones-respuesta-juego mt-3">
                <button id="btnJuegoIncorrecto" class="btn btn-danger btn-lg">✖</button>
                <button id="btnJuegoCorrecto" class="btn btn-success btn-lg">✔</button>
            </div>`;

        document.getElementById('btnJuegoCorrecto').onclick = () => {
            if (gameStateClient.turnoFinalizado) return;
            gameStateClient.resultadosDelTurnoActual.push({ palabra: palabraObj, correcta: true });
            if (!gameStateClient.palabrasAcertadasEnPartidaGlobal.find(p => p.texto.toLowerCase() === palabraObj.texto.toLowerCase())) {
                gameStateClient.palabrasAcertadasEnPartidaGlobal.push(palabraObj);
            }
            gameStateClient.palabraActualmenteEnJuego = null; 
            mostrarSiguientePalabraJuego();
        };
        document.getElementById('btnJuegoIncorrecto').onclick = () => {
            if (gameStateClient.turnoFinalizado) return;
            gameStateClient.resultadosDelTurnoActual.push({ palabra: palabraObj, correcta: false });
            gameStateClient.palabrasIncorrectasTurnoActual.push(palabraObj);
            gameStateClient.palabraActualmenteEnJuego = null; 
            mostrarSiguientePalabraJuego();
        };
    }

    window.postRender_revision_turno = () => {
        const jugadorActual = gameStateClient.turnoActual.jugador;
        document.getElementById('revisionNombreJugador').textContent = jugadorActual ? jugadorActual.nombre : 'N/A';

        const list = document.getElementById('listaRevisionPalabras'); list.innerHTML = '';
        const arr = gameStateClient.resultadosDelTurnoActual;

        if (!arr.length) list.innerHTML = '<p class="list-group-item text-center text-muted">No se jugó ninguna palabra en este turno.</p>';

        arr.forEach((r, i) => {
            const div = document.createElement('div');
            div.className = `list-group-item d-flex justify-content-between align-items-center ${r.correcta ? 'list-group-item-success' : 'list-group-item-danger'}`;
            div.innerHTML = `
                <span>${i + 1}. ${r.palabra.texto}</span>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm ${r.correcta ? 'btn-success' : 'btn-outline-success'}" data-idx="${i}" data-correct="true">✔ Correcta</button>
                    <button class="btn btn-sm ${!r.correcta ? 'btn-danger' : 'btn-outline-danger'}" data-idx="${i}" data-correct="false">✖ Incorrecta</button>
                </div>`;

            div.querySelectorAll('button').forEach(b => b.onclick = () => {
                const idx = +b.dataset.idx;
                const esCorrectaAhora = b.dataset.correct === 'true';
                const palabraObjetoRevisada = arr[idx].palabra;

                if (arr[idx].correcta !== esCorrectaAhora) {
                    arr[idx].correcta = esCorrectaAhora;

                    if (esCorrectaAhora) {
                        if (!gameStateClient.palabrasAcertadasEnPartidaGlobal.find(p => p.texto.toLowerCase() === palabraObjetoRevisada.texto.toLowerCase())) {
                            gameStateClient.palabrasAcertadasEnPartidaGlobal.push(palabraObjetoRevisada);
                        }
                        gameStateClient.palabrasIncorrectasTurnoActual = gameStateClient.palabrasIncorrectasTurnoActual.filter(pObj => pObj.texto.toLowerCase() !== palabraObjetoRevisada.texto.toLowerCase());
                    } else {
                        gameStateClient.palabrasAcertadasEnPartidaGlobal = gameStateClient.palabrasAcertadasEnPartidaGlobal.filter(pObj => pObj.texto.toLowerCase() !== palabraObjetoRevisada.texto.toLowerCase());
                        if (!gameStateClient.palabrasIncorrectasTurnoActual.find(p => p.texto.toLowerCase() === palabraObjetoRevisada.texto.toLowerCase())) {
                            gameStateClient.palabrasIncorrectasTurnoActual.push(palabraObjetoRevisada);
                        }
                    }
                    renderView('template-revision-turno');
                }
            });
            list.appendChild(div);
        });
        document.getElementById('btnConfirmarRevision').onclick = procesarFinDeTurnoLogica;
    };

    function procesarFinDeTurnoLogica() {
        const equipoIdx = gameStateClient.turnoActual.equipoIndex;
        const puntosEsteTurno = gameStateClient.resultadosDelTurnoActual.filter(r => r.correcta).length;

        if (!gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual]) {
            gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual] = {};
            gameStateClient.equipos.forEach((_, i) => gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual][i] = 0);
        }
        gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual][equipoIdx] = (gameStateClient.puntosPorEquipoPorRonda[gameStateClient.rondaActual][equipoIdx] || 0) + puntosEsteTurno;

        gameStateClient.palabrasDisponiblesRonda.push(...gameStateClient.palabrasIncorrectasTurnoActual);
        gameStateClient.palabrasDisponiblesRonda.sort(() => 0.5 - Math.random());

        renderView('template-vista-equipos');
    }

    window.postRender_resultados_finales = () => {
        const th = document.querySelector('#tablaResultados thead tr'); th.innerHTML = '';
        const tb = document.querySelector('#tablaResultados tbody'); tb.innerHTML = '';

        const numColumnasRonda = gameStateClient.config.maxRondas;

        let headerHtml = '<th>Equipo</th>';
        for (let r = 1; r <= numColumnasRonda; r++) {
            headerHtml += `<th>Ronda ${r}</th>`;
        }
        headerHtml += '<th>Total</th>';
        th.innerHTML = headerHtml;

        const puntajesFinales = gameStateClient.equipos.map((equipo, i) => {
            let totalEquipo = 0;
            for (let r = 1; r <= gameStateClient.config.maxRondas; r++) {
                totalEquipo += (gameStateClient.puntosPorEquipoPorRonda[r] && gameStateClient.puntosPorEquipoPorRonda[r][i]) || 0;
            }
            return { equipoNombre: `Equipo ${i + 1}`, puntaje: totalEquipo, originalIndex: i };
        });

        puntajesFinales.sort((a, b) => b.puntaje - a.puntaje);
        const maxPuntaje = puntajesFinales.length > 0 ? puntajesFinales[0].puntaje : 0;

        puntajesFinales.forEach(equipoData => {
            const i = equipoData.originalIndex;
            const esGanador = equipoData.puntaje === maxPuntaje && maxPuntaje > 0;
            const row = document.createElement('tr');
            if (esGanador) row.classList.add('table-success', 'fw-bold');

            let html = `<td>${equipoData.equipoNombre} ${esGanador ? '🏆' : ''}</td>`;
            for (let r = 1; r <= numColumnasRonda; r++) {
                const puntosRonda = (gameStateClient.puntosPorEquipoPorRonda[r] && typeof gameStateClient.puntosPorEquipoPorRonda[r][i] !== 'undefined')
                    ? gameStateClient.puntosPorEquipoPorRonda[r][i]
                    : (r <= gameStateClient.rondaActual ? 0 : '-');
                html += `<td>${puntosRonda}</td>`;
            }
            html += `<td><strong>${equipoData.puntaje}</strong></td>`;
            row.innerHTML = html;
            tb.appendChild(row);
        });

        const btnJugarNuevo = document.querySelector('#template-resultados-finales [data-action="viewInicio"]');
        if (btnJugarNuevo) {
            btnJugarNuevo.addEventListener('click', () => {
                resetGameState();
            }, { once: true });
        }
    };


    function getTeamColorForDisplay(index) {
        // Adjusted colors for better vibrancy and distinction on the new UI
        const hex = ['#EF5350', '#66BB6A', '#5C6BC0', '#FF7043', '#26A69A', '#AB47BC', '#FFCA28', '#29B6F6'];
        return hex[index % hex.length];
    }

    function showToast(msg, type = 'info', dur = 4000, description = null) {
        if (!window.sileo) {
            console.log('Sileo notification:', msg);
            return;
        }

        // Si hay descripción, aumentamos la duración para que de tiempo a ver la animación
        const finalDur = description ? 6000 : dur;

        const baseOpts = {
            title: msg,
            description: description,
            duration: finalDur,
            fill: '#171717',
            // Autopilot: expande a los 500ms y colapsa a los 4000ms
            autopilot: description ? { expand: 500, collapse: 4000 } : true
        };
        
        if (type === 'success') {
            window.sileo.success({ 
                ...baseOpts,
                styles: { title: 'color: #66BB6A !important;' }
            });
        } else if (type === 'danger') {
            window.sileo.error({ 
                ...baseOpts,
                styles: { title: 'color: #EF5350 !important;' }
            });
        } else if (type === 'warning') {
            window.sileo.warning({ 
                ...baseOpts,
                styles: { title: 'color: #FFA726 !important;' }
            });
        } else {
            window.sileo.info({ 
                ...baseOpts,
                styles: { title: 'color: #29B6F6 !important;' }
            });
        }
    }

    async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text); showToast('Copiado', 'success', 1500); } catch { showToast('Error', 'danger', 2000, 'No se pudo copiar el código.'); } }

    function addPalabraAListaUI(palabraTexto, pkgId, esMia = false) {
        if (currentPaqueteId !== pkgId) return;
        const ul = document.getElementById('listaPalabrasPaquete'); if (!ul) return;

        // Solo renderizar en la UI si es la vista de gestionar paquete
        // y la palabra es del usuario actual (addedBy userUUID)
        // O si no estamos filtrando (lo cual ya no es el caso aquí)
        if (document.getElementById('template-gestionar-paquete')) { // Ensure we are on the right view
             if (!esMia) return; // Only show words added by me if `filtrarParaGestion` is implicitly true

            const exists = Array.from(ul.children).some(li => 
                li.textContent.trim().toLowerCase() === palabraTexto.toLowerCase() &&
                !li.classList.contains('list-group-item-info') && // ignore header/info li
                !li.classList.contains('list-group-item-light') // ignore footer/info li
            );
            if (exists) return;

            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.textContent = palabraTexto;

            // If list only contains placeholders/info, clear it before adding real words
            const nonWordItems = ul.querySelectorAll('.list-group-item-info, .list-group-item-light, .text-muted');
            const actualWordItems = ul.querySelectorAll('li:not(.list-group-item-info):not(.list-group-item-light):not(.text-muted)');
            
            if (actualWordItems.length === 0 && nonWordItems.length > 0) {
                // If only info items are present, clear them
                // This might be too aggressive, depends on desired behavior. For now, just add.
                // Example: if "No has añadido palabras" is showing, remove it.
                if (ul.firstChild && ul.firstChild.classList.contains('text-muted')) {
                    ul.innerHTML = ''; // Clears "No has añadido..." or "Cargando..."
                     // Re-add "Mostrando X palabras..." if it was there
                    const pkg = getMisPaquetesLocales().find(p => p.id === pkgId);
                     if (pkg && pkg.ownerId === userUUID) { // Simple check, might need server data for accuracy
                        const headerLi = document.createElement('li');
                        headerLi.className = 'list-group-item list-group-item-info text-center small';
                        headerLi.textContent = 'Mostrando 1 palabra añadida por ti.'; // Will be updated by full load
                        ul.appendChild(headerLi);
                    }
                }
            }
            
            // Add new word after info header, before total info footer
            const infoHeader = ul.querySelector('.list-group-item-info');
            const infoFooter = ul.querySelector('.list-group-item-light');

            if (infoHeader && infoFooter) {
                ul.insertBefore(li, infoFooter);
            } else if (infoHeader) {
                ul.appendChild(li); // Add after header if no footer
            } else {
                ul.insertBefore(li, ul.firstChild); // Add to top if no header
            }
        }
    }


    async function cargarPalabrasDelPaquete(id, filtrarParaGestion = false) {
        const ul = document.getElementById('listaPalabrasPaquete'); if (!ul) return;
        ul.innerHTML = '<li class="list-group-item text-muted text-center">Cargando palabras...</li>';
        try {
            const res = await fetch(`/api/paquetes/${id}`);
            const pkg = await res.json();
            if (!res.ok) throw new Error(pkg.message || 'Error al cargar paquete');

            ul.innerHTML = ''; // Clear loading message

            let palabrasAMostrar = pkg.palabras;
            if (filtrarParaGestion) { // This is always true when called from gestionar_paquete
                palabrasAMostrar = pkg.palabras.filter(pObj => pObj.addedBy === userUUID);
                
                // Header for "tus palabras"
                const infoLi = document.createElement('li');
                infoLi.className = 'list-group-item list-group-item-info text-center small';
                if (palabrasAMostrar.length > 0) {
                    infoLi.textContent = `Mostrando ${palabrasAMostrar.length} palabra(s) añadidas por ti:`;
                } else {
                    infoLi.textContent = 'No has añadido palabras a este paquete aún.';
                }
                ul.appendChild(infoLi);
            }

            if (palabrasAMostrar.length > 0) {
                palabrasAMostrar.slice().reverse().forEach(palabraObj => { // Show newest first
                    const li = document.createElement('li');
                    li.className = 'list-group-item';
                    li.textContent = palabraObj.texto;
                    ul.appendChild(li);
                });
            } else if (!filtrarParaGestion && pkg.palabras.length === 0) { 
                // This case is unlikely if filtrarParaGestion is always true here
                ul.innerHTML = '<li class="list-group-item text-muted text-center">Este paquete no tiene palabras aún.</li>';
            }

            // Footer showing total words if filtering by self
            if (filtrarParaGestion && pkg.palabras.length > palabrasAMostrar.length) {
                const totalWordsInPackage = pkg.palabras.length;
                const otherCollaboratorWords = totalWordsInPackage - palabrasAMostrar.length;
                const infoTotal = document.createElement('li');
                infoTotal.className = 'list-group-item list-group-item-light text-center small fst-italic';
                infoTotal.textContent = `(Total de ${totalWordsInPackage} palabras en el paquete. ${otherCollaboratorWords} de otros colaboradores)`;
                ul.appendChild(infoTotal);
            } else if (filtrarParaGestion && pkg.palabras.length > 0 && palabrasAMostrar.length === 0) {
                 const infoTotal = document.createElement('li');
                infoTotal.className = 'list-group-item list-group-item-light text-center small fst-italic';
                infoTotal.textContent = `(Este paquete tiene ${pkg.palabras.length} palabras de otros colaboradores, pero ninguna tuya)`;
                ul.appendChild(infoTotal);
            }


        } catch (e) {
            ul.innerHTML = `<li class="list-group-item text-danger text-center">Error al cargar palabras: ${e.message}</li>`;
        }
    }

    const LOCAL_STORAGE_KEY = 'partyFunRemixMisPaquetes';
    function getMisPaquetesLocales() { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || []; }
    function saveMisPaquetesLocales(arr) { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(arr)); }
    function addMiPaqueteLocal(pkgData) {
        const arr = getMisPaquetesLocales();
        const i = arr.findIndex(p => p.id === pkgData.id);
        if (i > -1) {
            arr[i] = { ...arr[i], ...pkgData }; // Update existing
        } else {
            arr.push(pkgData); // Add new
        }
        saveMisPaquetesLocales(arr);
    }

    document.body.addEventListener('click', (event) => {
        let currentElement = event.target;
        while (currentElement && currentElement !== document.body) {
            const action = currentElement.getAttribute('data-action');
            if (action && action.startsWith('view')) {
                event.preventDefault();
                const viewNamePart = action.substring(4); // e.g., "Inicio", "CrearPaquete"
                // Convert PascalCase or camelCase to kebab-case for template ID
                const kebabCaseName = viewNamePart.replace(/([A-Z])/g, (match, letter, offset) => (offset > 0 ? '-' : '') + letter.toLowerCase()).replace(/^-/, '');
                const templateIdToRender = `template-${kebabCaseName}`; // e.g., template-inicio, template-crear-paquete
                
                if (document.getElementById(templateIdToRender)) {
                     // Special reset logic if going back to major reset points AND game was in progress
                    if ((action === 'viewInicio' || action === 'viewConfigurarPartida') && 
                        gameStateClient.partidaComenzada &&
                        !(activeView && activeView.querySelector('#btnTerminarPartidaVolverConfig') === currentElement) // Exclude if it's the explicit "terminar partida" button
                    ) {
                        // Don't reset if it's the explicit "Terminar Partida y Volver a Config." button
                        // because that button's specific handler already deals with confirmation and reset.
                        // Here we only reset if navigating back via other means (e.g. header logo, generic back button)
                        // If game state needs to be reset more broadly or via confirm, this could be expanded
                        console.log(`Resetting game state due to navigation to ${action} while partidaComenzada was true.`);
                        resetGameState(); 
                    }
                    renderView(templateIdToRender);
                } else {
                    console.error(`Error: No se encontró el template: ${templateIdToRender} para la acción ${action}`);
                    showToast(`Error interno: Vista no encontrada (${action}).`, 'danger');
                }
                return; // Action handled
            }
            currentElement = currentElement.parentElement;
        }
    });

    // SOCKET.IO EVENT HANDLERS
    socket.on('palabra_anadida', data => {
        // Si estamos en la vista de gestión del paquete afectado, refrescamos la lista de palabras.
        if (currentPaqueteId === data.paqueteId && activeView && activeView.querySelector('#tituloGestionPaquete')) {
            // Re-cargamos toda la lista de palabras. Esto actualizará la lista y los contadores.
            cargarPalabrasDelPaquete(currentPaqueteId, true);
        }

        // Mostramos una notificación toast solo si la palabra la hemos añadido nosotros.
        if (data.palabraObjeto.addedBy === userUUID) {
            showToast(`"${data.palabraObjeto.texto}" añadida.`, `success`, 2000);
        }

        // Update local storage count for the package
        const paquetesLocales = getMisPaquetesLocales();
        const paqueteIndex = paquetesLocales.findIndex(p => p.id === data.paqueteId);
        if (paqueteIndex > -1) {
            // Fetch fresh package data to get accurate word count (numPalabras)
            fetch(`/api/paquetes/${data.paqueteId}`)
                .then(res => res.json())
                .then(pkg => {
                    if (pkg && typeof pkg.numPalabras !== 'undefined') {
                        paquetesLocales[paqueteIndex].numPalabras = pkg.numPalabras;
                        saveMisPaquetesLocales(paquetesLocales);
                    }
                }).catch(err => console.error("Error actualizando numPalabras desde servidor tras palabra_anadida", err));
        }
    });

    socket.on('estado_paquete_cambiado', data => { 
        const paquetes = getMisPaquetesLocales();
        const paqueteAfectado = paquetes.find(p => p.id === data.paqueteId);
        const nombrePaqueteParaToast = paqueteAfectado ? `"${paqueteAfectado.nombre}"` : "un paquete";

        if (currentPaqueteId === data.paqueteId && document.getElementById('template-gestionar-paquete')) {
            const switchEl = document.getElementById('switchPaqueteAbierto');
            const formAdd = document.getElementById('formAnadirPalabra');
            
            if (switchEl) switchEl.checked = data.abierto;
            
            const soyElOwnerReal = paqueteAfectado && paqueteAfectado.ownerId === userUUID;
            const canAddWords = data.abierto || soyElOwnerReal;

            if (formAdd) formAdd.style.display = canAddWords ? 'flex' : 'none';
            
            const estado = data.abierto ? 'abierto' : 'cerrado';
            if (data.changedBy === userUUID) {
                showToast('Estado actualizado', 'info', 4000, `Has ${estado} el paquete ${nombrePaqueteParaToast}.`);
            } else {
                showToast('Estado actualizado', 'info', 4000, `El creador ha ${estado} el paquete ${nombrePaqueteParaToast}.`);
            }
        } else {
            const estado = data.abierto ? 'abierto' : 'cerrado';
            showToast('Estado actualizado', 'info', 4000, `El paquete ${nombrePaqueteParaToast} ahora está ${estado}.`);
        }

        // Update local storage
        const idx = paquetes.findIndex(p => p.id === data.paqueteId);
        if (idx > -1) {
            if (paquetes[idx]) { // Ensure package still exists locally
                paquetes[idx].abierto = data.abierto;
                saveMisPaquetesLocales(paquetes);
            }
        }
    });

    socket.on('paquete_eliminado', (data) => {
        console.log('Evento paquete_eliminado recibido:', data);
        const { paqueteId, nombrePaquete, deletedBy } = data;
        const paqueteEliminadoInfo = removerPaqueteLocalmente(paqueteId);
        const nombreRealPaquete = paqueteEliminadoInfo ? paqueteEliminadoInfo.nombre : nombrePaquete;

        if (deletedBy === userUUID) {
            // This client initiated the delete. Toast & view update is handled by `confirmarYEliminarPaquete`.
        } else {
             // If the package was in "my local packages" list, then notify and update UI.
            if (paqueteEliminadoInfo) { 
                showToast('Paquete eliminado', 'warning', 4000, `"${nombreRealPaquete}" fue borrado por su creador.`);

                const gestionViewActive = activeView && activeView.querySelector('#tituloGestionPaquete');
                const listaViewActive = activeView && activeView.querySelector('#listaMisPaquetes');
                
                if (currentPaqueteId === paqueteId && gestionViewActive && activeView && activeView.contains(gestionViewActive)) {
                    currentPaqueteId = null;
                    renderView('template-listar-mis-paquetes');
                } else if (listaViewActive && activeView && activeView.contains(listaViewActive)) {
                    renderView('template-listar-mis-paquetes');
                }
            }
            // If !paqueteEliminadoInfo, this user wasn't collaborating or didn't have it in their local list,
            // so no need to show a toast or change view.
        }
    });


    // Initial logic to check for join link in URL
    const urlParams = new URLSearchParams(window.location.search);
    const joinPaqueteId = urlParams.get('join');

    if (joinPaqueteId) {
        // Clear the URL parameter to prevent re-joining on refresh
        history.replaceState(null, '', window.location.pathname);
        
        // Directly fetch package and render it, as there's no formal "join" action anymore.
        fetch(`/api/paquetes/${joinPaqueteId}`)
            .then(res => {
                if (!res.ok) {
                    // Try to parse the error message from the server
                    return res.json().then(err => { throw new Error(err.message || 'Código no válido o paquete no encontrado.') });
                }
                return res.json();
            })
            .then(pkg => {
                if (pkg.id) {
                    addMiPaqueteLocal({ id: pkg.id, nombre: pkg.nombre, numPalabras: pkg.palabras.length, ownerId: pkg.ownerId, abierto: pkg.abierto });
                    currentPaqueteId = pkg.id;
                    renderView('template-gestionar-paquete', pkg);
                    showToast(`Has cargado el paquete "${pkg.nombre}". Ahora puedes añadir palabras.`, 'success');
                } else {
                    showToast('No se pudo cargar el paquete para gestionar.', 'danger');
                    renderView('template-inicio');
                }
            })
            .catch(err => {
                console.error('Error fetching package from join link:', err);
                showToast(err.message, 'danger');
                renderView('template-inicio');
            });
    } else {
        renderView('template-inicio'); // Render home view by default
    }
});