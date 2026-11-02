
(() => {
  "use strict";

  const cfg = window.FAMILYCHAT_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  let sb = null;
  let user = null;
  let active = null;
  let channel = null;
  let conversations = [];
  let validatingInvite = false;

  // Mostrar mensajes
  const msg = (text, id = "loginStatus", bad = false) => {
    const element = $(id);

    if (!element) {
      console.error("No se encontró el elemento:", id);
      return;
    }

    element.textContent = text;
    element.style.color = bad ? "#bd4545" : "var(--purple)";
  };

  // Comprobar configuración
  const ready = () =>
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PEGA_AQUI");

  // Mostrar inicio de sesión
  function login() {
    $("loginView")?.classList.remove("hidden");
    $("appView")?.classList.add("hidden");
  }

  // Entrar en la aplicación
  async function enter(u) {
    user = u;

    const { data: p, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();

    if (error) {
      login();
      msg("Error leyendo perfil: " + error.message, "loginStatus", true);
      return;
    }

    if (!p?.invite_accepted) {
      login();
      msg(
        "Introduce la clave de invitación después de iniciar sesión con Google."
      );
      return;
    }

    $("profileName").textContent =
      p.display_name || u.user_metadata?.full_name || "Usuario";

    $("profileEmail").textContent = u.email || "";

    $("avatar").src =
      p.avatar_url || u.user_metadata?.avatar_url || "icon.svg";

    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");

    await loadConversations();
  }

  // Cargar conversaciones
  async function loadConversations() {
    const { data, error } = await sb
      .from("conversation_members")
      .select("conversation_id,conversations(id,title,is_group)")
      .eq("user_id", user.id);

    if (error) {
      msg(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map((item) => item.conversations)
      .filter(Boolean);

    const list = $("conversationList");
    list.innerHTML = "";

    if (!conversations.length) {
      list.innerHTML =
        '<p class="muted small">Todavía no tienes conversaciones.</p>';
      return;
    }

    conversations.forEach((conversation) => {
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

  // Abrir chat
  async function openChat(conversation) {
    active = conversation;

    $("chatTitle").textContent = conversation.title;
    $("emptyState").classList.add("hidden");
    $("messages").classList.remove("hidden");
    $("messageForm").classList.remove("hidden");

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

  // Cargar mensajes
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

    (data || []).forEach((message) => {
      const element = document.createElement("div");

      element.className =
        "message" + (message.sender_id === user.id ? " mine" : "");

      const body = document.createElement("div");
      body.textContent = message.body;

      const time = document.createElement("small");
      time.textContent = new Date(
        message.created_at
      ).toLocaleString();

      element.append(body, time);
      box.append(element);
    });

    box.scrollTop = box.scrollHeight;
  }

  // Iniciar sesión con Google
  $("googleBtn").onclick = async () => {
    if (!sb) {
      msg("Supabase no está conectado.", "loginStatus", true);
      return;
    }

    const button = $("googleBtn");
    button.disabled = true;

    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin +
            window.location.pathname
        }
      });

      if (error) {
        msg(error.message, "loginStatus", true);
        button.disabled = false;
      }
    } catch (error) {
      msg(error.message, "loginStatus", true);
      button.disabled = false;
    }
  };

  // Validar invitación
  $("inviteBtn").onclick = async () => {
    if (validatingInvite) return;

    if (!user) {
      msg("Primero inicia sesión con Google.");
      return;
    }

    const input = $("inviteInput");
    const button = $("inviteBtn");

    const code = input?.value.trim();

    if (!code) {
      msg("Escribe la clave de invitación.");
      return;
    }

    validatingInvite = true;
    button.disabled = true;

    try {
      msg("Validando invitación...");

      const { error } = await sb.rpc("redeem_invite", {
        p_code: code
      });

      if (error) {
        msg(error.message, "loginStatus", true);
        return;
      }

      msg("¡Invitación validada!");

      await enter(user);

    } catch (error) {
      msg(
        "Error al validar: " + error.message,
        "loginStatus",
        true
      );
    } finally {
      validatingInvite = false;
      button.disabled = false;
    }
  };

  // Cerrar sesión
  $("logoutBtn").onclick = async () => {
    try {
      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }

      await sb.auth.signOut();
      user = null;
      active = null;
      login();

    } catch (error) {
      msg(error.message, "appStatus", true);
    }
  };

  // Crear grupo
  $("newGroupBtn").onclick = async () => {
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

      if (error) {
        msg(error.message, "appStatus", true);
        return;
      }

      const result = await sb
        .from("conversation_members")
        .insert({
          conversation_id: conversation.id,
          user_id: user.id
        });

      if (result.error) {
        msg(result.error.message, "appStatus", true);
        return;
      }

      await loadConversations();
      await openChat(conversation);

    } catch (error) {
      msg(error.message, "appStatus", true);
    }
  };

  // Enviar mensajes
  $("messageForm").onsubmit = async (event) => {
    event.preventDefault();

    if (!active) return;

    const input = $("messageInput");
    const body = input.value.trim();

    if (!body) return;

    input.value = "";

    try {
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

    } catch (error) {
      input.value = body;
      msg(error.message, "appStatus", true);
    }
  };

  // Inicializar aplicación
  async function init() {
    if (!ready()) {
      msg(
        "Configura config.js con la URL y Publishable key de Supabase."
      );
      return;
    }

    if (!window.supabase) {
      msg(
        "No se pudo cargar Supabase. Revisa tu conexión a internet.",
        "loginStatus",
        true
      );
      return;
    }

    sb = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_PUBLISHABLE_KEY
    );

    const {
      data: { session },
      error
    } = await sb.auth.getSession();

    if (error) {
      msg(error.message, "loginStatus", true);
      return;
    }

    if (session) {
      await enter(session.user);
    }

    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        enter(session.user).catch((error) => {
          msg(error.message, "loginStatus", true);
        });
      } else {
        user = null;
        login();
      }
    });
  }

  init().catch((error) => {
    console.error("FamilyChat:", error);
    msg(error.message, "loginStatus", true);
  });

})();
