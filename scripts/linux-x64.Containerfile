FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget ca-certificates gnupg git \
    cmake make gcc g++ \
    autoconf automake libtool pkg-config \
    libzstd-dev zlib1g-dev libsqlite3-dev libcurl4-openssl-dev libpq-dev libssl-dev

RUN wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - \
 && echo "deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy-21 main" > /etc/apt/sources.list.d/llvm-21.list \
 && apt-get update \
 && apt-get install -y clang-21 lld-21 llvm-21-dev \
 && ln -sf /usr/bin/clang-21 /usr/bin/clang \
 && ln -sf /usr/bin/llvm-config-21 /usr/bin/llvm-config

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs

RUN apt-get install -y rustc cargo lldb-21

WORKDIR /ws
CMD ["/bin/bash"]
