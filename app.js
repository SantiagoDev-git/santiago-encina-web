    
     const SUPABASE_URL = "https://kpltcxhnqhgzgxazhgbv.supabase.co";
        const SUPABASE_ANON_KEY = "sb_publishable_rdFjhKYduJglnoq-D0jHOw_7ik0VaFG"; 
        
        const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const urlParams = new URLSearchParams(window.location.search);
        const libroFiltro = urlParams.get('libro'); 
        const estadoPago = urlParams.get('estado');

        let imgNuevoUrl = "";
        let imgOfertaUrl = "";
        let libroActualComentarios = null;
        let usuarioSesion = null;
        let mailAutor = "";

        // Mostrar estado del pago
        const alertaEl = document.getElementById('alerta-pago');
        if (estadoPago === 'exito') {
            alertaEl.className = "mensaje-alerta exito";
            alertaEl.innerText = "¡Pago procesado con éxito! Ya podés disfrutar de tu lectura.";
            alertaEl.style.display = "block";
        } else if (estadoPago === 'error') {
            alertaEl.className = "mensaje-alerta error";
            alertaEl.innerText = "Hubo un problema con el pago. Por favor intentá nuevamente.";
            alertaEl.style.display = "block";
        }

        // VERIFICAR AUTENTICACIÓN / SESIÓN ACTIVA
        async function revisarSesion() {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const navActions = document.getElementById('nav-actions');

            if (session && session.user) {
                usuarioSesion = session.user;
                navActions.innerHTML = `
                    <span class="user-email">👤 ${session.user.email}</span>
                    <button class="btn-nav" onclick="abrirModal('modal-soporte')">Soporte</button>
                    <button class="btn-nav" onclick="cerrarSesion()">Cerrar Sesión</button>
                `;
            } else {
                usuarioSesion = null;
                navActions.innerHTML = `
                    <button class="btn-nav" onclick="abrirModal('modal-soporte')">Soporte</button>
                    <button class="btn-nav" onclick="abrirModal('modal-login')">Iniciar Sesión</button>
                    <button class="btn-nav btn-nav-primary" onclick="abrirModal('modal-registro')">Registrarse</button>
                `;
            }
        }

        // FUNCIONES DE AUTH
        async function ejecutarRegistro(e) {
            e.preventDefault();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;

            // Indicamos la URL de retorno tras confirmar el correo
            const { data, error } = await supabaseClient.auth.signUp({ 
                email, 
                password,
                options: {
                    emailRedirectTo: window.location.href // Lo regresa a tu index.html tras hacer clic en el mail
                }
            });

            if (error) {
                alert("Error al registrarse: " + error.message);
                return;
            }

            // Si el usuario se creó pero requiere confirmación
            if (data.user && data.user.identities && data.user.identities.length === 0) {
                alert("Este correo ya se encuentra registrado. Por favor, iniciá sesión.");
            } else {
                alert("✨ ¡Cuenta registrada con éxito!\n\nHemos enviado un enlace de confirmación a " + email + ". Por favor, revisá tu bandeja de entrada (o carpeta de Spam) y hacé clic en el enlace para activar tu cuenta de lector.");
                cerrarModal('modal-registro');
            }
        }

        async function ejecutarLogin(e) {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;

            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                if (error.message.includes("Email not confirmed")) {
                    alert("✉️ Tu correo electrónico aún no ha sido verificado.\n\nPor favor, revisá tu casilla de correo para confirmar tu cuenta antes de ingresar.");
                } else {
                    alert("Error de inicio de sesión: " + error.message);
                }
            } else {
                cerrarModal('modal-login');
                await revisarSesion();
                await cargarCatalogo();
            }
        }

        async function cerrarSesion() {
            await supabaseClient.auth.signOut();
            revisarSesion();
            cargarCatalogo();
        }

        // FUNCIONES MODALES
        function abrirModal(id) { document.getElementById(id).style.display = 'flex'; }
        function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

        // DATOS AUTOR
        async function cargarDatosAutor() {
            try {
                const { data: autor, error } = await supabaseClient
                    .from('autor')
                    .select('*')
                    .eq('id', 1)
                    .single();

                if (error || !autor) return;

                imgNuevoUrl = autor.img_nuevo_url || "";
                imgOfertaUrl = autor.img_oferta_url || "";
                mailAutor = autor.mail || "";

                const headerEl = document.getElementById('seccion-autor');
                if (autor.img_fondo_url) {
                    headerEl.style.backgroundImage = `url('${autor.img_fondo_url}')`;
                }
                document.getElementById('autor-foto').src = autor.img_foto_url || '';
                document.getElementById('autor-biografia').innerText = autor.biografia || '';
                headerEl.style.display = 'flex';

                if (autor.mensage) {
                    document.getElementById('autor-mensaje').innerText = autor.mensage;
                    document.getElementById('seccion-marquesina').style.display = 'block';
                }
            } catch (err) {
                console.error("Error al cargar autor:", err);
            }
        }

        // CATÁLOGO CON BOTÓN INTELIGENTE Y CONTADOR DE COMENTARIOS APROBADOS
        async function cargarCatalogo() {
            const contenedor = document.getElementById('contenedor-catalogo');

            try {
                let query = supabaseClient.from('libros').select('*');

                if (libroFiltro) {
                    query = query.eq('id', libroFiltro);
                }

                const { data: libros, error } = await query;

                if (error || !libros || libros.length === 0) {
                    contenedor.innerHTML = "<p style='text-align:center;'>No hay libros disponibles en este momento.</p>";
                    return;
                }

                contenedor.innerHTML = "";

                for (const libro of libros) {
                    // Contamos únicamente los comentarios APROBADOS con la clave 'ok'
                    const { count } = await supabaseClient
                        .from('comentarios_revision')
                        .select('*', { count: 'exact', head: true })
                        .eq('libro_id', libro.id)
                        .eq('estado', 'ok'); // <--- Filtro clave para el contador público

                    const totalComentarios = count || 0;

                    // VERIFICAR ESTADO DE LICENCIA SI HAY SESIÓN
                    let tieneLicencia = false;

                    if (usuarioSesion) {
                        const { data: licenciaData } = await supabaseClient
                            .from('licencias')
                            .select('activo')
                            .eq('user_id', usuarioSesion.id)
                            .eq('libro_id', libro.id)
                            .eq('activo', true)
                            .maybeSingle();

                        if (licenciaData && licenciaData.activo) {
                            tieneLicencia = true;
                        }
                    }

                    let badgesHtml = '';
                    if (libro.es_nuevo && imgNuevoUrl) {
                        badgesHtml += `<img src="${imgNuevoUrl}" alt="Novedad" class="badge-img"> `;
                    }
                    if (libro.es_oferta && imgOfertaUrl) {
                        badgesHtml += `<img src="${imgOfertaUrl}" alt="Oferta" class="badge-img">`;
                    }

                    const precioMostrado = libro.precio ? libro.precio : (libro.precio_ars ? libro.precio_ars : '0');
                    const palabrasInfo = libro.cant_palabras ? ` | 📖 ${Number(libro.cant_palabras).toLocaleString('es-AR')} palabras` : '';

                    let filaAmazonHtml = '';
                    if (libro.amz_activo) {
                        let formatosAmz = '';
                        if (libro.amz_ebook) formatosAmz += `<span class="pill-formato">e-Book</span> `;
                        if (libro.amz_blanda) formatosAmz += `<span class="pill-formato">Tapa Blanda</span> `;
                        if (libro.amz_dura) formatosAmz += `<span class="pill-formato">Tapa Dura</span>`;

                        filaAmazonHtml = `
                            <div class="tienda-fila">
                                <a href="${libro.amz_url || '#'}" target="_blank" class="tienda-link">
                                    🛒 También disponible en Amazon ↗
                                </a>
                                <div class="formatos-pills">${formatosAmz}</div>
                            </div>
                        `;
                    }

                    let filaPublicaHtml = '';
                    if (libro.pub_activo) {
                        let formatosPub = '';
                        if (libro.pub_ebook) formatosPub += `<span class="pill-formato">e-Book</span> `;
                        if (libro.pub_blanda) formatosPub += `<span class="pill-formato">Tapa Blanda</span> `;
                        if (libro.pub_dura) formatosPub += `<span class="pill-formato">Tapa Dura</span>`;

                        filaPublicaHtml = `
                            <div class="tienda-fila">
                                <a href="${libro.pub_url || '#'}" target="_blank" class="tienda-link">
                                    📖 Disponible en Publica.now ↗
                                </a>
                                <div class="formatos-pills">${formatosPub}</div>
                            </div>
                        `;
                    }

                    let cajaTiendasHtml = '';
                    if (filaAmazonHtml || filaPublicaHtml) {
                        cajaTiendasHtml = `
                            <div class="tiendas-externas-box">
                                ${filaAmazonHtml}
                                ${filaPublicaHtml}
                            </div>
                        `;
                    }

                    // CONFIGURAR TEXTO Y ACCIÓN DEL BOTÓN INTELIGENTE
                    let textoBoton = "Adquirir Licencia Digital";
                    let estiloBotonColor = "";
                    if (tieneLicencia) {
                        textoBoton = "📖 Continuar Leyendo";
                        estiloBotonColor = "background: #2e7d32;";
                    }

                    const tarjeta = document.createElement('div');
                    tarjeta.className = 'card-libro';
                    tarjeta.innerHTML = `
                        <div class="portada-container">
                            <img src="${libro.portada_url || ''}" alt="Portada de ${libro.titulo}" class="portada">
                        </div>
                        <div class="info-container">
                            <div>
                                <div class="titulo-container">
                                    <h3>${libro.titulo}</h3>
                                    ${badgesHtml}
                                </div>
                                <div class="meta-info">
                                    ${libro.autor ? `Por <span>${libro.autor}</span>` : ''} 
                                    ${libro.genero ? `| Género: <span>${libro.genero}</span>` : ''}
                                    ${palabrasInfo}
                                </div>
                            </div>
                            <div class="sinopsis-scroll">
                                ${libro.sinopsis || 'Sin descripción disponible.'}
                            </div>
                            <div class="comprar-row">
                                <div class="precio-comentarios-box">
                                    <div class="precio">$ ${precioMostrado} ARS</div>
                                    <button class="btn-comentarios" onclick="abrirComentarios('${libro.id}', '${libro.titulo}')">
                                        💬 <span id="count-${libro.id}">${totalComentarios}</span>
                                    </button>
                                </div>
                                <button class="btn-comprar" id="btn-${libro.id}" style="${estiloBotonColor}" onclick="accionBotonLibro('${libro.id}', ${tieneLicencia})">
                                    ${textoBoton}
                                </button>
                            </div>
                            ${cajaTiendasHtml}
                        </div>
                    `;
                    contenedor.appendChild(tarjeta);
                }

            } catch (err) {
                console.error("Excepción:", err);
                contenedor.innerHTML = `<p style="color: red; text-align:center;">Ocurrió un error al cargar el catálogo.</p>`;
            }
        }

        // ABRIR COMENTARIOS Y LIMPIAR CAMPOS PARA MOSTRAR PLACEHOLDERS
        async function abrirComentarios(libroId, titulo) {
            libroActualComentarios = libroId;
            document.getElementById('modal-titulo-libro').innerText = `Comentarios: ${titulo}`;
            
            const inputNombre = document.getElementById('input-nombre');
            const inputTexto = document.getElementById('input-texto');

            if (inputNombre) {
                inputNombre.value = '';
            }

            // Limpiamos siempre el área de texto para mostrar la sugerencia/placeholder
            if (inputTexto) {
                inputTexto.value = '';
            }

            abrirModal('modal-comentarios');
            await cargarComentariosDelLibro(libroId);
        }

        // ACCIÓN DEL BOTÓN INTELIGENTE (CON TRANSICIÓN SUAVE)
        async function accionBotonLibro(libroId, tieneLicencia) {
            if (!usuarioSesion) {
                alert("Para adquirir una licencia o leer tus libros, por favor iniciá sesión o registrate.");
                abrirModal('modal-login');
                return;
            }

            if (!tieneLicencia) {
                iniciarPago(libroId);
            } else {
                // 1. Obtenemos el botón y le damos feedback visual inmediato y suave
                const btn = document.getElementById(`btn-${libroId}`);
                const textoOriginal = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = "⏳ Abriendo lector...";

                // 2. Validamos el dispositivo contra Supabase
                const permitido = await verificarAccesoYDispositivo(libroId);
                
                if (!permitido) {
                    // Si se bloqueó (es otro dispositivo), restauramos el botón y abrimos el modal
                    btn.disabled = false;
                    btn.innerHTML = textoOriginal;
                    return; 
                }

                // 3. Transición limpia hacia el visor de lectura
                window.location.href = `reader.html?libro_id=${libroId}`;
            }
        }

        // Función que valida la huella del dispositivo usando el email
        async function verificarAccesoYDispositivo(libroId) {
            // 1. Obtener o crear la huella digital del navegador local
            let localDeviceId = localStorage.getItem("lector_device_id");
            if (!localDeviceId) {
                const screenRes = `${window.screen.width}x${window.screen.height}`;
                const randomHash = Math.random().toString(36).substring(2, 15);
                localDeviceId = "DEV-" + btoa(`${screenRes}-${randomHash}`).replace(/=/g, '');
                localStorage.setItem("lector_device_id", localDeviceId);
            }

            // 2. Consultar a la función segura de Supabase (RPC)
            const { data: autorizado, error } = await supabaseClient.rpc('verificar_o_registrar_dispositivo', {
                p_libro_id: libroId,
                p_device_id: localDeviceId
            });

            if (error) {
                console.error("Error al validar dispositivo:", error.message);
                alert("Ocurrió un error al verificar tu acceso.");
                return false;
            }

            // 3. Evaluar el resultado
            if (autorizado) {
                return true; // ¡Acceso permitido! Pasamos al lector
            } else {
                // No autorizado (es otro dispositivo o no hay licencia)
                mostrarModalBloqueoDispositivo();
                return false; // Frena la ejecución en seco
            }
        }

        function mostrarModalBloqueoDispositivo() {
            document.getElementById('modal-bloqueo-dispositivo').style.display = 'flex';
        }

        function cerrarModalDispositivo() {
            document.getElementById('modal-bloqueo-dispositivo').style.display = 'none';
        }

        function irASoporteDesdeBloqueo() {
            cerrarModalDispositivo();
            if (typeof abrirModal === 'function') {
                abrirModal('modal-soporte');
            } else {
                // Redirección si está en reader.html
                window.location.href = 'index.html?modal=soporte';
            }
        }

        async function cargarComentariosDelLibro(libroId) {
            const contenedor = document.getElementById('lista-comentarios'); // ID correcto del modal
            if (!contenedor) return;

            contenedor.innerHTML = `<p style="text-align:center; color:#888; padding: 10px;">Buscando comentarios...</p>`;

            // Pedimos solo los comentarios aprobados con 'ok'
            const { data: comentarios, error } = await supabaseClient
                .from('comentarios_revision')
                .select('*')
                .eq('libro_id', libroId)
                .eq('estado', 'ok')
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error al cargar comentarios:", error);
                contenedor.innerHTML = `<p style="text-align:center; color:red; padding: 10px;">Error al cargar comentarios.</p>`;
                return;
            }

            if (!comentarios || comentarios.length === 0) {
                contenedor.innerHTML = `<p style="text-align:center; color:#888; font-style:italic; padding:15px;">Sé el primero en dejar un comentario para esta obra.</p>`;
            } else {
                contenedor.innerHTML = comentarios.map(c => `
                    <div style="background-color: #27272a; padding: 10px 14px; border-radius: 8px; border: 1px solid #3f3f46; margin-bottom: 8px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-weight: bold; font-size: 12px; color: #fbbf24;">${c.nombre}</span>
                            <span style="font-size: 10px; color: #71717a;">${new Date(c.created_at).toLocaleDateString()}</span>
                        </div>
                        <p style="font-size: 13px; color: #e4e4e7; margin: 0; line-height: 1.4;">${c.contenido}</p>
                    </div>
                `).join('');
            }

            // Actualizamos el contador público del botón
            const countSpan = document.getElementById(`count-${libroId}`);
            if (countSpan) {
                countSpan.innerText = comentarios ? comentarios.length : 0;
            }
        }

        // 1. Función auxiliar para desarmar cualquier intento de script HTML
        function sanitizarTexto(texto) {
            const div = document.createElement('div');
            div.innerText = texto; // Convierte HTML a texto plano seguro
            return div.innerHTML;
        }

        // 2. Función de guardado para moderación
        async function guardarComentario(e) {
            e.preventDefault();

            // 1. Si no hay sesión, guiamos al lector para que inicie sesión
            if (!usuarioSesion) {
                alert("Para dejar un comentario, por favor iniciá sesión o registrate.");
                cerrarModal('modal-comentarios');
                abrirModal('modal-login');
                return;
            }

            if (!libroActualComentarios) return;

            const nombreInput = document.getElementById('input-nombre');
            const textoInput = document.getElementById('input-texto');

            const nombre = sanitizarTexto(nombreInput.value.trim());
            const texto = sanitizarTexto(textoInput.value.trim());

            if (!nombre || !texto) return;

            // Guardamos el comentario usando el email de la sesión activa
            const { error } = await supabaseClient
                .from('comentarios_revision')
                .insert([{ 
                    libro_id: libroActualComentarios, 
                    usuario_email: usuarioSesion.email, 
                    nombre: nombre, 
                    contenido: texto,
                    estado: 'pendiente'
                }]);

            if (error) {
                alert("Error al enviar comentario: " + error.message);
                return;
            }

            nombreInput.value = "";
            textoInput.value = "";

            cerrarModal('modal-comentarios');
            mostrarAvisoRevision();
        }

        // FUNCIÓN DE PAGO ACTUALIZADA: Envía email y libro_id al servidor
        async function iniciarPago(idLibro) {
            const btn = document.getElementById(`btn-${idLibro}`);
            btn.disabled = true;
            btn.innerText = "Procesando...";

            try {
                const response = await fetch(`${SUPABASE_URL}/functions/v1/crear-preferencia`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: usuarioSesion.email, libro_id: idLibro })
                });

                const data = await response.json();

                if (data.init_point) {
                    window.location.href = data.init_point; 
                } else {
                    alert("Error al iniciar el pago: " + (data.error || "Intente más tarde."));
                    btn.disabled = false;
                    btn.innerText = "Adquirir Licencia Digital";
                }
            } catch (e) {
                alert("Error de conexión con el servidor de pagos");
                btn.disabled = false;
                btn.innerText = "Adquirir Licencia Digital";
            }
        }

        async function inicializarPagina() {
            await revisarSesion();
            await cargarDatosAutor();
            await cargarCatalogo();
        }

        function enviarMensajeSoporte(e) {
            e.preventDefault();

            if (!mailAutor) {
                alert("El servicio de contacto no está disponible en este momento.");
                return;
            }

            const asunto = document.getElementById('soporte-asunto').value.trim();
            const mensaje = document.getElementById('soporte-mensaje').value.trim();

            if (!asunto || !mensaje) return;

            const mailtoUrl = `mailto:${mailAutor}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
            window.location.href = mailtoUrl;

            document.getElementById('soporte-asunto').value = '';
            document.getElementById('soporte-mensaje').value = '';
            cerrarModal('modal-soporte');
        }

        inicializarPagina();

        function mostrarAvisoRevision() {
            const toast = document.getElementById("comentario-toast");
            if (toast) {
                toast.style.display = "block";
                setTimeout(() => {
                    toast.style.display = "none";
                }, 4000); // 4 segundos visible
            }
        }   
    
    // Función para abrir y cerrar preguntas frecuentes de forma suave
        function toggleFaq(button) {
            const faqItem = button.parentElement;
            const isSelfActive = faqItem.classList.contains('active');
            
            // Opcional: Cierra otros ítems para mantener la prolijidad
            document.querySelectorAll('.faq-item').forEach(item => {
                item.classList.remove('active');
            });

            if (!isSelfActive) {
                faqItem.classList.add('active');
            }
        }