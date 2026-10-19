// Chefe Geral Ponte: lançador mínimo da Ponte do Mac.
// Roda relay.py com /usr/bin/python3 como processo FILHO deste app, para o macOS (TCC) atribuir
// o acesso à pasta Documentos ao app "Chefe Geral Ponte" (com.chefegeral.ponte), e não ao python.
#include <dirent.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static pid_t filho = 0;

static void repassar_sinal(int s) { if (filho > 0) kill(filho, s); }

// Toca na pasta Documentos uma vez: na primeira vez o macOS mostra o pedido de permissão para este app.
static void sondar_documentos(const char *home) {
    char p[4096];
    snprintf(p, sizeof p, "%s/Documents", home);
    DIR *d = opendir(p);
    if (d) { readdir(d); closedir(d); fprintf(stderr, "ponte-app: acesso a Documentos ok\n"); }
    else perror("ponte-app: sem acesso a Documentos");
}

int main(int argc, char **argv) {
    const char *home = getenv("HOME");
    if (!home) { fprintf(stderr, "ponte-app: HOME ausente\n"); return 1; }
    sondar_documentos(home);
    if (argc > 1 && strcmp(argv[1], "--sondar") == 0) return 0;
    char relay[4096];
    const char *r = getenv("CHEFE_RELAY");
    if (r) snprintf(relay, sizeof relay, "%s", r);
    else snprintf(relay, sizeof relay, "%s/Library/Application Support/ChefeGeral/relay/relay.py", home);
    char *args[] = {"/usr/bin/python3", relay, NULL};
    signal(SIGTERM, repassar_sinal);
    signal(SIGINT, repassar_sinal);
    signal(SIGHUP, repassar_sinal);
    int e = posix_spawn(&filho, args[0], NULL, NULL, args, environ);
    if (e != 0) { fprintf(stderr, "ponte-app: falha ao iniciar python3 (%s)\n", strerror(e)); return 1; }
    int st = 0;
    while (waitpid(filho, &st, 0) < 0) {}
    return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
