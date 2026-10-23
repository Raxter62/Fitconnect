FROM php:8.2-apache

# PostgreSQL + HTTP API + UTF-8 字串處理需要的系統函式庫
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq-dev \
        libcurl4-openssl-dev \
        libonig-dev \
    && docker-php-ext-install \
        pdo_pgsql \
        curl \
        mbstring \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

# 🔧 建置階段：清掉所有 MPM，只留下 mpm_prefork + rewrite
RUN rm -f /etc/apache2/mods-enabled/mpm_*.load /etc/apache2/mods-enabled/mpm_*.conf \
    && ln -s /etc/apache2/mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load \
    && ln -s /etc/apache2/mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf \
    && a2enmod rewrite
#Apache 有三種主要的 MPM（Multi-Processing Module）：
#mpm_prefork
#mpm_worker
#mpm_event
#三個互斥的 規則：一次只能開一種 否則:AH00534: apache2: Configuration error: More than one MPM loaded.



# 複製專案檔案
WORKDIR /var/www/html
COPY . /var/www/html
RUN php tools/stamp-release.php


EXPOSE 80

# 🔧 啟動階段：再保險一次，把 event/worker 關掉後 mods-enabled 移除 才啟動 Apache
CMD ["bash", "-c", "a2dismod mpm_event mpm_worker >/dev/null 2>&1 || true && apache2-foreground"]
