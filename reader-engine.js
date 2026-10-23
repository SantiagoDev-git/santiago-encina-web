/* ==========================================================================
   reader-engine.js - Motor de lectura, autenticación y descifrado AES-GCM
   ========================================================================== */

const SUPABASE_URL = "https://kpltcxhnqhgzgxazhgbv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_rdFjhKYduJglnoq-D0jHOw_7ik0VaFG";

const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let libroActualId = null;
let emailUsuarioActual = null;
let capituloActualTexto = "cap_00"; // Ej: "cap_01"

// Funciones auxiliares de conversión binaria
function hexToBytes(hexString) {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }
  return bytes;
}

function base64ToBytes(base64String) {
  const binaryString = atob(base64String);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Descifra el Base64 y devuelve el ArrayBuffer binario directamente
 */
async function decryptChapterToBuffer(base64Payload, hexKey) {
  try {
    // 1. Convertir la clave HEX a CryptoKey
    const rawKey = hexToBytes(hexKey);
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    // 2. Convertir el Base64 enviado por el servidor a bytes binarios
    const encryptedData = base64ToBytes(base64Payload);

    // 3. Separar las partes según el orden exacto de cifrar.py:
    const iv = encryptedData.slice(0, 12);
    const tag = encryptedData.slice(12, 28);
    const ciphertext = encryptedData.slice(28);

    // 4. Web Crypto API exige concatenar CIPHERTEXT + TAG (Tag al final)
    const combinedData = new Uint8Array(ciphertext.length + tag.length);
    combinedData.set(ciphertext, 0);
    combinedData.set(tag, ciphertext.length);

    // 5. Descifrar en la memoria RAM
    return await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128 // 16 bytes = 128 bits
      },
      cryptoKey,
      combinedData
    );

  } catch (error) {
    console.error("Error al descifrar:", error);
    throw new Error("Fallo en el descifrado del contenido.");
  }
}

/**
 * Inicializa la lectura pidiendo al servidor el estado actual (email + libro_id)
 */
async function cargarLectorInicial() {
  const contentContainer = document.getElementById("chapter-content");
  bloquearBotonesCargando(true);
  if (!contentContainer) return;

  contentContainer.innerHTML = `<div class="text-center py-12 opacity-65 italic">Conectando con el servidor seguro...</div>`;

  try {
    if (!supabaseClient) {
      throw new Error("El cliente de Supabase no está inicializado.");
    }

    // 1. Obtener sesión activa para extraer el email del usuario de forma segura
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    
    if (sessionError || !session || !session.user) {
      alert("Debes iniciar sesión para leer este libro.");
      window.location.href = "index.html";
      return;
    }

    emailUsuarioActual = session.user.email;

    // 2. Extraer el 'libro_id' desde los parámetros de la URL (?libro_id=...)
    const urlParams = new URLSearchParams(window.location.search);
    libroActualId = urlParams.get('libro_id');

    if (!libroActualId) {
      throw new Error("No se especificó el libro a leer.");
    }

    console.log("🚀 [DEBUG] Solicitando capítulo actual al servidor para:", emailUsuarioActual, "| Libro:", libroActualId);

    // 3. Invocar la Edge Function 'get-chapter' enviando únicamente email y libro_id
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-chapter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ email: emailUsuarioActual, libro_id: libroActualId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error al obtener el capítulo.");
    }

    // Guardar referencia del capítulo actual devuelto por el servidor
    capituloActualTexto = data.id; // ej: "cap_01"

    // 4. Descifrar el contenido
    const decryptedBuffer = await decryptChapterToBuffer(data.contenido_cifrado, data.clave_desencriptacion);

    // 5. Renderizar contenido (Texto o Imagen/Portada)
    const titleContainer = document.getElementById("chapter-title");
    if (data.tipo === 'imagen') {
      if (titleContainer) titleContainer.innerText = data.titulo || "Portada";

      const blob = new Blob([decryptedBuffer], { type: 'image/jpeg' });
      const imageUrl = URL.createObjectURL(blob);

      contentContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-2 select-none">
            <div class="bg-[#fffdf9] p-3 rounded shadow-2xl border border-[#d8cbb3]" style="box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
                <img src="${imageUrl}" alt="Portada del Libro" class="max-h-[350px] w-auto object-contain rounded-sm" />
            </div>
            <p class="text-[11px] text-[#8c785f] font-cinzel mt-4 tracking-widest uppercase">Edición Segura de Autor</p>
        </div>
      `;
    } else {
        // 1. Asignar el título del capítulo
        if (titleContainer) {
            titleContainer.innerText = data.titulo || `Capítulo`;
        }

        // 2. Decodificar los bytes descifrados a texto UTF-8
        const decoder = new TextDecoder("utf-8");
        let htmlContenido = decoder.decode(decryptedBuffer);

        // 3. Convertir saltos de línea (\n) en párrafos o saltos <br> si no vienen envueltos en <p>
        // Si el archivo no tiene etiquetas <p>, envolvemos cada bloque separado por saltos de línea
        if (!htmlContenido.includes("<p>")) {
            htmlContenido = htmlContenido
            .split(/\n\s*\n/) // Separar por saltos de línea dobles (párrafos)
            .map(parrafo => parrafo.trim())
            .filter(parrafo => parrafo.length > 0)
            .map(parrafo => {
                // Si ya es un encabezado HTML (ej: <h1>Prólogo</h1>), no lo envolvemos en <p>
                if (parrafo.startsWith("<h")) return parrafo;
                return `<p>${parrafo.replace(/\n/g, "<br>")}</p>`;
            })
            .join("");
        }

        // 4. Inyectar el HTML procesado
        contentContainer.innerHTML = `
            <div class="lectura-editorial text-justify leading-relaxed font-merriweather space-y-4">
            ${htmlContenido}
            </div>
        `;
    }

    // 6. Restaurar la posición del scroll enviada en el paquete
    const scrollContainer = document.getElementById("scroll-container");
    if (scrollContainer) {
      setTimeout(() => {
        scrollContainer.scrollTop = data.posicion_scroll || 0;
      }, 50);
    }

    // 7. Configurar estado inicial de los botones según el capítulo actual
    actualizarEstadoBotones(capituloActualTexto);

  } catch (err) {
    console.error("❌ [DEBUG] Error en el lector:", err);
    contentContainer.innerHTML = `<div class="text-red-800 p-4 text-center font-semibold">Acceso denegado o error: ${err.message}</div>`;
  }
}

/**
 * Extrae el número del formato "cap_XX" y ajusta la UI de los botones
 */
function actualizarEstadoBotones(capId) {
  const numMatch = capId.match(/\d+/);
  const numCap = numMatch ? parseInt(numMatch[0], 10) : 0;

  const btnAnterior = document.getElementById("btn-anterior");
  if (btnAnterior) {
    if (numCap <= 0) {
      btnAnterior.disabled = true;
      btnAnterior.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      btnAnterior.disabled = false;
      btnAnterior.classList.remove("opacity-50", "cursor-not-allowed");
    }
  }

  bloquearBotonesCargando(false);
}


/**
 * Función central de navegación y guardado mediante la Edge Function 'actualizar-progreso'
 */
async function cambiarCapituloNavegacion(delta) {
  const numMatch = capituloActualTexto.match(/\d+/);
  let numCapActual = numMatch ? parseInt(numMatch[0], 10) : 0;
  
  let nuevoNumCap = numCapActual + delta;
  if (nuevoNumCap < 0) nuevoNumCap = 0;

  const scrollContainer = document.getElementById("scroll-container");
  const scrollActual = scrollContainer ? scrollContainer.scrollTop : 0;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    // Llamamos a nuestra Edge Function 'actualizar-progreso'
    const response = await fetch(`${SUPABASE_URL}/functions/v1/actualizar-progreso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        email: emailUsuarioActual,
        libro_id: libroActualId,
        num_capitulo: nuevoNumCap,
        num_scroll: 0 // Al cambiar de capítulo reiniciamos el scroll arriba
      })
    });

    const resultado = await response.json();

    if (!response.ok) {
      if (resultado.error === "fin del libro") {
        alert("Has llegado al final del libro.");
        return;
      }
      throw new Error(resultado.error || "No se pudo cambiar de capítulo.");
    }

    // Si todo salió bien en la actualización, recargamos el lector para traer el nuevo capítulo
    window.location.reload();
    bloquearBotonesCargando(true);

  } catch (err) {
    console.error("Error al navegar:", err);
    alert(err.message);
  }
}

/**
 * Botón Guardar: Envía la posición actual del scroll y el capítulo actual al servidor
 */
async function guardarProgresoActual() {
  const numMatch = capituloActualTexto.match(/\d+/);
  const numCapActual = numMatch ? parseInt(numMatch[0], 10) : 0;

  const scrollContainer = document.getElementById("scroll-container");
  const scrollActual = scrollContainer ? scrollContainer.scrollTop : 0;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/actualizar-progreso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        email: emailUsuarioActual,
        libro_id: libroActualId,
        num_capitulo: numCapActual,
        num_scroll: scrollActual
      })
    });

    if (!response.ok) {
      const res = await response.json();
      throw new Error(res.error || "Error al guardar progreso.");
    }

    alert("¡Progreso y posición guardados con éxito!");

  } catch (err) {
    console.error("Error al guardar:", err);
    alert("No se pudo guardar el progreso.");
  }
}

// --- FUNCIONES DE ESTADO DE CARGA (UX) ---
function bloquearBotonesCargando(bloquear) {
    const btnAnterior = document.getElementById("btn-anterior");
    const btnSiguiente = document.getElementById("btn-siguiente");
    const btnGuardar = document.getElementById("btn-guardar");

    if (bloquear) {
        // Ocultar botones de capítulo y poner el de guardar en modo "espera"
        if (btnAnterior) btnAnterior.style.visibility = "hidden";
        if (btnSiguiente) btnSiguiente.style.visibility = "hidden";
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.innerText = "⏳ Buscando capítulo...";
            btnGuardar.classList.add("opacity-50", "cursor-not-allowed");
        }
    } else {
        // Restaurar botones a la normalidad
        if (btnAnterior) btnAnterior.style.visibility = "visible";
        if (btnSiguiente) btnSiguiente.style.visibility = "visible";
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerText = "💾 Guardar";
            btnGuardar.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }
}


// --- NAVEGACIÓN Y ACCESIBILIDAD POR TECLADO ---
document.addEventListener('keydown', (e) => {
    const scrollContainer = document.getElementById("scroll-container");
    const pasoScroll = 120; // Píxeles que desplaza cada pulsación de flecha

    // Ignorar si el usuario tiene un foco activo en un input o campo de texto
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.key) {
        case "ArrowUp": // Flecha Arriba -> Scroll Up
            e.preventDefault();
            if (scrollContainer) {
                scrollContainer.scrollBy({ top: -pasoScroll, behavior: 'smooth' });
            }
            break;

        case "ArrowDown": // Flecha Abajo -> Scroll Down
            e.preventDefault();
            if (scrollContainer) {
                scrollContainer.scrollBy({ top: pasoScroll, behavior: 'smooth' });
            }
            break;

        case "ArrowLeft": // Flecha Izquierda -> Anterior Capítulo
            e.preventDefault();
            if (typeof cambiarCapituloNavegacion === 'function') {
                cambiarCapituloNavegacion(-1);
            }
            break;

        case "ArrowRight": // Flecha Derecha -> Siguiente Capítulo
            e.preventDefault();
            if (typeof cambiarCapituloNavegacion === 'function') {
                cambiarCapituloNavegacion(1);
            }
            break;

        case "Enter": // Enter -> Guardar página actual
            e.preventDefault();
            if (typeof guardarProgresoActual === 'function') {
                guardarProgresoActual();
            }
            break;

        case "Escape": // Esc -> Volver a la pantalla principal
            e.preventDefault();
            window.location.href = "index.html";
            break;
    }
});

// Inicializar al cargar el DOM del reader
document.addEventListener("DOMContentLoaded", () => {
  cargarLectorInicial();
});