// Client-side rendering for the Hacker News clone.
// Fetches posts from /api/posts and builds the DOM.

function renderPosts(posts) {
  var content = document.getElementById("content");
  content.innerHTML = "";

  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    var rank = i + 1;

    var postDiv = document.createElement("div");
    postDiv.className = "post";

    var rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = rank + ".";

    var upvoteForm = document.createElement("form");
    upvoteForm.method = "POST";
    upvoteForm.setAttribute("data-id", post.id);
    upvoteForm.style.display = "inline";

    var upvoteBtn = document.createElement("button");
    upvoteBtn.type = "submit";
    upvoteBtn.className = "upvote";
    upvoteBtn.title = "upvote";
    upvoteForm.appendChild(upvoteBtn);

    var titleSpan = document.createElement("span");
    titleSpan.className = "title";
    var titleLink = document.createElement("a");
    titleLink.href = post.url;
    titleLink.textContent = post.title;
    titleSpan.appendChild(titleLink);

    postDiv.appendChild(rankSpan);
    postDiv.appendChild(upvoteForm);
    postDiv.appendChild(titleSpan);

    var metaDiv = document.createElement("div");
    metaDiv.className = "meta";
    metaDiv.textContent = post.points + " points";

    content.appendChild(postDiv);
    content.appendChild(metaDiv);
  }
}

function upvote(id, metaDiv) {
  fetch("/upvote/" + id, { method: "POST" });
  var pts = parseInt(metaDiv.textContent, 10);
  metaDiv.textContent = pts + 1 + " points";
}

document.addEventListener("submit", function (e) {
  e.preventDefault();
  var form = e.target;
  var id = form.getAttribute("data-id");
  if (id) {
    var metaDiv = form.closest(".post").nextElementSibling;
    upvote(id, metaDiv);
  }
});

fetch("/api/posts")
  .then(function (res) {
    return res.json();
  })
  .then(renderPosts);
