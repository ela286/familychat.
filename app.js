
(() => {
  "use strict";

  const cfg = window.FAMILYCHAT_CONFIG || {};
  const $ = id => document.getElementById(id);

  let sb = null;
  let user = null;
  let active = null;
  let channel = null;
  let conversations = [];
  let contacts = [];
  let requests = [];
  let loading = false;

  const msg = (text, id = "loginStatus", bad = false) => {
    const element = $(id);
    if (!element) return;

    element.textContent = text;
    element.style.color = bad ? "#bd4545" : "var(--purple)";
  };

  const ready = () =>
    cfg.SUPABASE_URL?.startsWith("https://") &&
    cfg.SUPABASE_PUBLISHABLE_KEY;

  function login() {
    $("loginView")?.classList.remove("hidden");
    $("appView")?.classList.add("hidden");
  }

  function showApp() {
    $("loginView")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");
  }

  // PERFIL E INICIO
  async function enter(u) {
    if (loading) return;
    loading = true;

    try {
      user = u;

      const { data: profile, error } = await sb
        .from("profiles")
        .select("*")
        .eq("id", u.id)
        .maybeSingle();

      if (error) throw error;

      if (!profile?.invite_accepted) {
        login();
        msg("Introduce tu clave de invitación después de entrar con Google.");
        return;
      }

      $("profileName").textContent =
        profile.display_name ||
        u.user_metadata?.full_name ||
        "Usuario";

      $("profileEmail").textContent = u.email || "";

      $("avatar").src =
        profile.avatar_url ||
        u.user_metadata?.avatar_url ||
        "icon.svg";

      showApp();

      await Promise.all([
        loadConversations(),
        loadContacts(),
        loadRequests()
      ]);

    } catch (error) {
      login();
      msg(error.message, "loginStatus", true);
    } finally {
      loading = false;
    }
  }

  // CREAR ELEMENTOS SEGUROS
  function createContactItem(person, actionText, action) {
    const item = document.createElement("div");
    item.className = "contact-item";

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar";
    avatar.textContent = "👤";

    if (person.avatar_url) {
      const image = document.createElement("img");
      image.src = person.avatar_url;
      image.alt = "";
      image.className = "contact-avatar";
      avatar.replaceWith(image);
    }

    const info = document.createElement("div");
    info.style.flex = "1";
    info.style.minWidth = "0";

    const name = document.createElement("strong");
    name.textContent =
      person.display_name || person.username || person.name || "Usuario";

    const detail = document.createElement("small");
    detail.textContent = person.email || "";

    info.append(name, detail);

    item.append(avatar, info);

    if (actionText && action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionText;
      button.onclick = action;
      item.append(button);
    }

    return item;
  }

  // BUSCAR USUARIOS
  async function searchUsers() {
    const term = $("userSearchInput").value.trim();
    const results = $("userSearchResults");

    results.innerHTML = "";

    if (term.length < 2) {
      results.textContent = "Escribe al menos 2 caracteres.";
      return;
    }

    msg("Buscando personas...", "appStatus");

    const { data, error } = await sb.rpc(
      "search_familychat_users",
      { p_search: term }
    );

    if (error) {
      msg("Error buscando usuarios: " + error.message, "appStatus", true);
      return;
    }

    if (!data?.length) {
      results.textContent = "No encontramos usuarios.";
      msg("", "appStatus");
      return;
    }

    data.forEach(person => {
      const id = person.id || person.user_id;

      const alreadyContact = contacts.some(
        contact => (contact.id || contact.user_id) === id
      );

      const item = createContactItem(
        person,
        alreadyContact ? "Agregado" : "Agregar",
        alreadyContact ? null : () => sendRequest(id)
      );

      results.append(item);
    });

    msg("Búsqueda terminada.", "appStatus");
  }

  async function sendRequest(recipientId) {
    const { error } = await sb.rpc("send_friend_request", {
      p_recipient_id: recipientId
    });

    if (error) {
      msg("No se pudo enviar: " + error.message, "appStatus", true);
      return;
    }

    msg("¡Solicitud enviada!", "appStatus");
    await loadContacts();
    await loadRequests();
    await searchUsers();
  }

  // SOLICITUDES RECIBIDAS
  async function loadRequests() {
    const list = $("friendRequestsList");
    const counter = $("requestCount");

    if (!list) return;

    const { data, error } = await sb.rpc("list_friend_requests");

    if (error) {
      list.textContent = "No se pudieron cargar las solicitudes.";
      console.error(error);
      return;
    }

    requests = data || [];
    list.innerHTML = "";

    if (counter) {
      counter.textContent = requests.length
        ? `(${requests.length})`
        : "";
    }

    if (!requests.length) {
      list.textContent = "No tienes solicitudes pendientes.";
      return;
    }

    requests.forEach(request => {
      const requestId = request.request_id || request.id;

      const person = {
        display_name:
          request.display_name ||
          request.username ||
          request.name ||
          "Usuario",
        avatar_url: request.avatar_url
      };

      const item = createContactItem(person, "Aceptar", async () => {
        await respondRequest(requestId, true);
      });

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Rechazar";
      reject.onclick = () => respondRequest(requestId, false);

      item.append(reject);
      list.append(item);
    });
  }

  async function respondRequest(requestId, accept) {
    const { error } = await sb.rpc("respond_friend_request", {
      p_request_id: requestId,
      p_accept: accept
    });

    if (error) {
      msg(error.message, "appStatus", true);
      return;
    }

    msg(
      accept ? "¡Contacto agregado!" : "Solicitud rechazada.",
      "appStatus"
    );

    await loadRequests();
    await loadContacts();
  }

  // CARGAR CONTACTOS
  async function loadContacts() {
    const list = $("contactsList");
    if (!list) return;

    const { data, error } = await sb.rpc("list_familychat_contacts");

    if (error) {
      list.textContent = "No se pudieron cargar los contactos.";
      console.error(error);
      return;
    }

    contacts = data || [];
    list.innerHTML = "";

    if (!contacts.length) {
      list.textContent = "Todavía no tienes contactos.";
      return;
    }

    contacts.forEach(person => {
      const item = createContactItem(
        person,
        "Chatear",
        () => createPrivateChat(person)
      );

      list.append(item);
    });
  }

  // CREAR CHAT PRIVADO
  async function createPrivateChat(person) {
    const personId = person.id || person.user_id;

    if (!personId) {
      msg("No se encontró el identificador del contacto.", "appStatus", true);
      return;
    }

    const title =
      person.display_name ||
      person.username ||
      person.name ||
      "Chat privado";

    try {
      const { data: conversation, error } = await sb
        .from("conversations")
        .insert({
          title,
          is_group: false,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      const { error: membersError } = await sb
        .from("conversation_members")
        .insert([
          {
            conversation_id: conversation.id,
            user_id: user.id
          },
          {
            conversation_id: conversation.id,
            user_id: personId
          }
        ]);

      if (membersError) throw membersError;

      await loadConversations();
      await openChat(conversation);

    } catch (error) {
      msg(
        "No se pudo crear el chat. Revisa las políticas de miembros en Supabase: " +
        error.message,
        "appStatus",
        true
      );
    }
  }

  // CARGAR CONVERSACIONES
  async function loadConversations() {
    const { data, error } = await sb
      .from("conversation_members")
      .select("conversation_id,conversations(id,title,is_group,created_by)")
      .eq("user_id", user.id);

    if (error) {
      msg(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map(item => item.conversations)
      .filter(Boolean);

    const list = $("conversationList");
    list.innerHTML = "";

    if (!conversations.length) {
      list.innerHTML =
        '<p class="muted small">Todavía no tienes conversaciones.</p>';
      return;
    }

    conversations.forEach(conversation => {
      const button = document.createElement("button");

      button.className =
        "conversation-item" +
        (active?.id === conversation.id ? " active" : "");

      const avatar = document.createElement("span");
      avatar.className = "conversation-avatar";
      avatar.textContent = conversation.is_group ? "👥" : "💬";

      const title = document.createElement("strong");
      title.textContent = conversation.title;

      button.append(avatar, title);
      button.onclick = () => openChat(conversation);

      list.append(button);
    });
  }

  // ABRIR CHAT
  async function openChat(conversation) {
    active = conversation;

    $("chatTitle").textContent = conversation.title;
    $("emptyState").classList.add("hidden");
    $("messages").classList.remove("hidden");
    $("messageForm").classList.remove("hidden");

    const addButton = $("addGroupMemberBtn");

    if (addButton) {
      addButton.classList.toggle("hidden", !conversation.is_group);
    }

    await loadMessages();

    if (channel) {
      await sb.removeChannel(channel);
    }

    channel = sb
      .channel("chat-" + conversation.id)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "conversation_id=eq." + conversation.id
        },
        () => loadMessages()
      )
      .subscribe();

    await loadConversations();
  }

  // CARGAR MENSAJES
  async function loadMessages() {
    if (!active) return;

    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", active.id)
      .order("created_at")
      .limit(200);

    if (error) {
      msg(error.message, "appStatus", true);
      return;
    }

    const box = $("messages");
    box.innerHTML = "";

    (data || []).forEach(message => {
      const element = document.createElement("div");

      element.className =
        "message" + (message.sender_id === user.id ? " mine" : "");

      const body = document.createElement("div");
      body.textContent = message.body;

      const time = document.createElement("small");
      time.textContent = new Date(message.created_at).toLocaleString();

      element.append(body, time);
      box.append(element);
    });

    box.scrollTop = box.scrollHeight;
  }

  // CREAR GRUPO
  async function createGroup() {
    const title = prompt("¿Cómo se llamará el grupo?");

    if (!title?.trim()) return;

    try {
      const { data: conversation, error } = await sb
        .from("conversations")
        .insert({
          title: title.trim(),
          is_group: true,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      const { error: memberError } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: conversation.id,
          user_id: user.id
        });

      if (memberError) throw memberError;

      await loadConversations();
      await openChat(conversation);

      msg("¡Grupo creado!", "appStatus");

    } catch (error) {
      msg("Error creando grupo: " + error.message, "appStatus", true);
    }
  }

  // AGREGAR PERSONAS A UN GRUPO
  async function addGroupMember() {
    if (!active?.is_group) return;

    if (!contacts.length) {
      msg("Primero agrega contactos.", "appStatus", true);
      return;
    }

    const options = contacts.map((person, index) => {
      const name =
        person.display_name ||
        person.username ||
        person.name ||
        "Usuario";

      return `${index + 1}. ${name}`;
    }).join("\n");

    const answer = prompt(
      "Escribe el número del contacto que quieres agregar:\n\n" +
      options
    );

    if (!answer) return;

    const index = Number(answer) - 1;

    if (!Number.isInteger(index) || index < 0 || index >= contacts.length) {
      msg("Número de contacto no válido.", "appStatus", true);
      return;
    }

    const person = contacts[index];
    const personId = person.id || person.user_id;

    try {
      const { error } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: active.id,
          user_id: personId
        });

      if (error) throw error;

      msg("¡Persona agregada al grupo!", "appStatus");

    } catch (error) {
      msg(
        "No se pudo agregar. Revisa las políticas de Supabase: " +
        error.message,
        "appStatus",
        true
      );
    }
  }

  // ENVIAR MENSAJES
  async function sendMessage(event) {
    event.preventDefault();

    if (!active) return;

    const input = $("messageInput");
    const body = input.value.trim();

    if (!body) return;

    input.value = "";

    const { error } = await sb
      .from("messages")
      .insert({
        conversation_id: active.id,
        sender_id: user.id,
        body
      });

    if (error) {
      input.value = body;
      msg(error.message, "appStatus", true);
    }
  }

  // BOTONES
  $("googleBtn").onclick = async () => {
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            window.location.origin + window.location.pathname
        }
      });

      if (error) msg(error.message, "loginStatus", true);

    } catch (error) {
      msg(error.message, "loginStatus", true);
    }
  };

  $("inviteBtn").onclick = async () => {
    if (!user) {
      msg("Primero inicia sesión con Google.");
      return;
    }

    const code = $("inviteInput").value.trim();

    if (!code) {
      msg("Escribe la clave de invitación.");
      return;
    }

    const button = $("inviteBtn");
    button.disabled = true;

    try {
      msg("Validando invitación...");

      const { error } = await sb.rpc("redeem_invite", {
        p_code: code
      });

      if (error) throw error;

      msg("¡Invitación validada!");
      await enter(user);

    } catch (error) {
      msg(error.message, "loginStatus", true);
    } finally {
      button.disabled = false;
    }
  };

  $("searchUsersBtn").onclick = searchUsers;

  $("userSearchInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchUsers();
    }
  });

  $("newGroupBtn").onclick = createGroup;
  $("addGroupMemberBtn").onclick = addGroupMember;
  $("messageForm").onsubmit = sendMessage;

  $("logoutBtn").onclick = async () => {
    if (channel) await sb.removeChannel(channel);

    await sb.auth.signOut();
    user = null;
    active = null;
    login();
  };

  // INICIAR APLICACIÓN
  async function init() {
    if (!ready()) {
      msg("Revisa la configuración de config.js.");
      return;
    }

    if (!window.supabase) {
      msg("No se pudo cargar Supabase.", "loginStatus", true);
      return;
    }

    sb = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_PUBLISHABLE_KEY
    );

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        enter(session.user);
      } else {
        user = null;
        login();
      }
    });

    if (data.session?.user) {
      await enter(data.session.user);
    } else {
      login();
    }
  }

  init().catch(error => {
    console.error("FamilyChat:", error);
    msg(error.message, "loginStatus", true);
  });

})();
