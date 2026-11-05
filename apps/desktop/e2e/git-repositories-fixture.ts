import { createGitRepositoriesFixture } from '../../../shared/remote-chat/testing/gitRepositoriesFixture';

export function repositoryFixture(root: string) {
  return createGitRepositoriesFixture(root, {
    onRequest: (operation, cwd) => {
      document.body.setAttribute(`data-git-${operation}-cwd`, cwd);
    },
    onSubmission: submissions => {
      document.body.dataset.gitSubmissions = JSON.stringify(submissions);
    },
    failChildPush: () => new URLSearchParams(location.search).has('failChildPush'),
  });
}
